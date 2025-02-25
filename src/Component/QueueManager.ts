import { Client, GuildMember, Message, TextChannel } from "discord.js";
import { exportableCustom } from "../AudioSource";
import { MessageEmbed } from "discord.js";
import * as AudioSource from "../AudioSource";
import { FallBackNotice, type GuildDataContainer } from "../definition";
import { getColor } from "../Util/colorUtil";
import { CalcHourMinSec, CalcMinSec, log, StringifyObject, timer } from "../Util";
import { ResponseMessage } from "./ResponseMessage";
import { ManagerBase } from "./ManagerBase";
import { PageToggle } from "./PageToggle";
import { TaskCancellationManager } from "./TaskCancellationManager";

export type KnownAudioSourceIdentifer = "youtube"|"custom"|"soundcloud"|"unknown";
/**
 * サーバーごとのキューを管理するマネージャー。
 * キューの追加および削除などの機能を提供します。
 */
export class QueueManager extends ManagerBase {
  // キューの本体
  private _default:QueueContent[] = [];
  // キューの本体のゲッタープロパティ
  private get default():QueueContent[] {
    return this._default;
  }
  // トラックループが有効か?
  LoopEnabled:boolean = false;
  // キューループが有効か?
  QueueLoopEnabled:boolean = false;
  // ワンスループが有効か?
  OnceLoopEnabled:boolean = false;
  // キューの長さ
  get length():number {
    return this.default.length;
  }
  get LengthSeconds():number{
    let totalLength = 0;
    this.default.forEach(q => totalLength += Number(q.BasicInfo.LengthSeconds));
    return totalLength;
  }
  get Nothing():boolean{
    return this.length === 0;
  }

  private processPending = [] as (()=>void)[];
  private waitForProcess(){
    return this.nowProcessing ? new Promise<void>((resolve) => this.processPending.push(resolve)) : Promise.resolve();
  }
  private _nowProcessing = false;
  private get nowProcessing(){
    return this._nowProcessing;
  }
  private set nowProcessing(val:boolean){
    this._nowProcessing = val;
    if(!val) {
      this.processPending.forEach(d => d());
      this.processPending = [];
    }
  }

  constructor(){
    super();
    this.SetTag("QueueManager");
    this.Log("Queue Manager instantiated");
  }

  SetData(data:GuildDataContainer){
    this.Log("Set data of guild id " + data.GuildID);
    super.SetData(data);
  }

  /**
   * キュー内の指定されたインデックスの内容を返します
   * @param index インデックス
   * @returns 指定された位置にあるキューコンテンツ
   */
  get(index:number){
    return this.default[index];
  }

  /**
   * キュー内で与えられた条件に適合するものを配列として返却します
   * @param predicate 条件を表す関数
   * @returns 条件に適合した要素の配列
   */
  filter(predicate: (value: QueueContent, index: number, array: QueueContent[]) => unknown, thisArg?: any):QueueContent[]{
    return this.default.filter(predicate, thisArg);
  }
  /**
   * キュー内のコンテンツから与えられた条件に一致する最初の要素のインデックスを返却します
   * @param predicate 条件
   * @returns インデックス
   */
  findIndex(predicate: (value: QueueContent, index: number, obj: QueueContent[]) => unknown, thisArg?: any):number{
    return this.default.findIndex(predicate, thisArg);
  }
  /**
   * キュー内のコンテンツのすべてで与えられた関数を実行し結果を配列として返却します
   * @param callbackfn 変換する関数
   * @returns 変換後の配列
   */
  map<T>(callbackfn: (value: QueueContent, index: number, array: QueueContent[]) => T, thisArg?: any):T[]{
    return this.default.map(callbackfn, thisArg);
  }

  getLengthSecondsTo(index:number){
    let sec = 0;
    if(index < 0) throw new Error("Invalid argument: " + index);
    const target = Math.min(index, this.length);
    for(let i = 0; i <= target; i++){
      sec += this.get(i).BasicInfo.LengthSeconds;
    }
    return sec;
  }

  async AddQueue(
      url:string, 
      addedBy:GuildMember|AddedBy, 
      method:"push"|"unshift" = "push", 
      type:KnownAudioSourceIdentifer = "unknown", 
      gotData:AudioSource.exportableCustom = null
      ):Promise<QueueContent & {index:number}>{
    await this.waitForProcess();
    this.nowProcessing = true;
    this.Log("AddQueue() called");
    const t = timer.start("AddQueue");
    PageToggle.Organize(this.info.Bot.Toggles, 5, this.info.GuildID);
    const result = {
      BasicInfo: await AudioSource.Resolve({
        url, type, 
        knownData:gotData, 
        forceCache: this.length === 0 || method === "unshift" || this.LengthSeconds < 4 * 60 * 60 * 1000
      }),
      AdditionalInfo:{
        AddedBy: {
          userId: (addedBy && (addedBy instanceof GuildMember ? addedBy.id : (addedBy as AddedBy).userId)) ?? "0",
          displayName: addedBy?.displayName ?? "不明"
        }
      }
    } as QueueContent;
    if(result.BasicInfo){
      this._default[method](result);
      if(this.info.EquallyPlayback) this.SortWithAddedBy();
      if(this.info.Bot.QueueModifiedGuilds.indexOf(this.info.GuildID) < 0){
        this.info.Bot.QueueModifiedGuilds.push(this.info.GuildID);
      }
      t.end();
      this.nowProcessing = false;
      const index = this._default.findIndex(q => q === result);
      this.Log("queue content added in position " + index);
      return {...result, index};
    }
    t.end();
    this.nowProcessing = false;
    throw new Error("Provided URL was not resolved as available service");
  }

  /**
   * ユーザーへのインタラクションやキュー追加までを一括して行います
   * @param client Botのクライアント
   * @param url 追加するソースのURL
   * @param addedBy 追加したユーザー
   * @param type 追加するURLのソースが判明している場合にはyoutubeまたはcustom、不明な場合はunknownを指定
   * @param first 最初に追加する場合はtrue、末尾に追加する場合はfalse
   * @param fromSearch 検索パネルの破棄を行うかどうか。検索パネルからのキュー追加の場合にはtrue、それ以外はfalse
   * @param channel 検索パネルからのキュー追加でない場合に、ユーザーへのインタラクションメッセージを送信するチャンネル。送信しない場合はnull
   * @param message 各インタラクションを上書きするメッセージが既にある場合はここにメッセージを指定します。それ以外の場合はnull
   * @param gotData すでにデータを取得していて新たにフェッチする必要がなくローカルでキューコンテンツをインスタンス化する場合はここにデータを指定します
   * @returns 成功した場合はtrue、それ以外の場合はfalse
   */
  async AutoAddQueue(
      client:Client, 
      url:string, 
      addedBy:GuildMember|AddedBy|null|undefined, 
      type:KnownAudioSourceIdentifer,
      first:boolean = false, 
      fromSearch:boolean|ResponseMessage = false, 
      channel:TextChannel = null,
      message:ResponseMessage = null,
      gotData:AudioSource.exportableCustom = null
      ):Promise<boolean>{
    this.Log("AutoAddQueue() Called");
    const t = timer.start("AutoAddQueue");
    let ch:TextChannel = null;
    let msg:Message|ResponseMessage = null;
    try{
      if(fromSearch && this.info.SearchPanel){
        // 検索パネルから
        this.Log("AutoAddQueue() From search panel");
        ch = await client.channels.fetch(this.info.SearchPanel.Msg.chId) as TextChannel;
        if(typeof fromSearch === "boolean"){
          msg = await (ch as TextChannel).messages.fetch(this.info.SearchPanel.Msg.id);
        }else{
          msg = fromSearch;
        }
        const tembed = new MessageEmbed();
        tembed.title = "お待ちください";
        tembed.description = "情報を取得しています...";
        await msg.edit({
          content: null, 
          embeds:[tembed],
          allowedMentions: {
            repliedUser: false
          },
          components: []
        });
      }else if(message){
        // すでに処理中メッセージがある
        this.Log("AutoAddQueue() Interaction message specified");
        ch = message.channel as TextChannel;
        msg = message;
      }else if(channel){
        // まだないので生成
        this.Log("AutoAddQueue() Interaction channel specified");
        ch = channel;
        msg = await channel.send("情報を取得しています。お待ちください...");
      }
      if(this.info.Queue.length > 999){
        // キュー上限
        this.Log("AutoAddQueue() Failed since too long queue", "warn");
        throw "キューの上限を超えています";
      }
      const info = await this.info.Queue.AddQueue(url, addedBy, first ? "unshift" : "push", type, gotData ?? null);
      this.Log("AutoAddQueue() Added successfully");
      if(msg){
        // 曲の時間取得＆計算
        const _t = Number(info.BasicInfo.LengthSeconds);
        const [min,sec] = CalcMinSec(_t);
        // キュー内のオフセット取得
        const index = info.index.toString();
        // ETAの計算
        const [ehour, emin, esec] = CalcHourMinSec(this.getLengthSecondsTo(info.index) - _t - Math.floor(this.info.Player.CurrentTime / 1000));
        const embed = new MessageEmbed()
          .setColor(getColor("SONG_ADDED"))
          .setTitle("✅曲が追加されました")
          .setDescription("[" + info.BasicInfo.Title + "](https://discord.gg/krtnftmmmtmt)")
          .addField("長さ", ((info.BasicInfo.ServiceIdentifer === "youtube" && (info.BasicInfo as AudioSource.YouTube).LiveStream) ? "ライブストリーム" : (_t !== 0 ? min + ":" + sec : "不明")), true)
          .addField("リクエスト", addedBy?.displayName ?? "不明", true)
          .addField("キュー内の位置", index === "0" ? "再生中/再生待ち" : index, true)
          .addField("再生されるまでの予想時間", index === "0" ? "-" : ((ehour === "0" ? "" : ehour + ":") + emin + ":" + esec), true)
          .setThumbnail(info.BasicInfo.Thumnail);
        if(info.BasicInfo.ServiceIdentifer === "youtube" && (info.BasicInfo as AudioSource.YouTube).IsFallbacked){
          embed.addField(":warning:注意", FallBackNotice);
        }
        await msg.edit({content: null, embeds:[embed]});
      }
    }
    catch(e){
      this.Log("AutoAddQueue() Failed");
      this.Log(StringifyObject(e), "error");
      if(msg){
        msg.edit({content: ":sob_tan: キューの追加に失敗しました。追加できませんでした。(" + e + ")", embeds: null}).catch(e => log(e, "error"));
      }
      t.end();
      return false;
    }
    t.end();
    return true;
  }

  /**
   * プレイリストを処理します
   * @param client botのクライアント
   * @param msg すでに返信済みの応答メッセージ
   * @param cancellation 処理のキャンセレーションマネージャー
   * @param queue キューマネージャー
   * @param first 最初に追加する場合はtrue、それ以外の場合はfalse
   * @param identifer オーディオソースサービス識別子
   * @param playlist プレイリスト本体。トラックの配列
   * @param title プレイリストのタイトル
   * @param totalCount プレイリストに含まれるトラック数
   * @param exportableConsumer トラックをexportableCustomに処理する関数
   * @returns 追加に成功した楽曲数
   */
  async ProcessPlaylist<T>(
    client:Client,
    msg:ResponseMessage,
    cancellation:TaskCancellationManager,
    first:boolean,
    identifer:KnownAudioSourceIdentifer, 
    playlist:T[], 
    title:string, 
    totalCount:number, 
    exportableConsumer:(track:T)=>Promise<exportableCustom>|exportableCustom
    ):Promise<number> {
    const t = timer.start("ProcessPlaylist");
    let index = 0;
    for(let i = 0; i < totalCount; i++){
      const item = playlist[i];
      if(!item) continue;
      const exportable = await exportableConsumer(item);
      const _result = await this.AutoAddQueue(client, exportable.url, msg.command.member, identifer, first, false, null, null, exportable);
      if(_result) index++;
      if(
        index % 50 === 0 || 
        (totalCount <= 50 && index % 10 === 0) || 
        totalCount <= 10
      ){
        await msg.edit(":sleeping_tan:プレイリスト`" + title + "`を処理しています。お待ちください。" + totalCount + "曲中" + index + "曲処理済み。");
      }
      if(cancellation.Cancelled)
        break;
    }
    t.end();
    return index;
  }

  /**
   * 次の曲に移動します
   */
  async Next(){
    this.Log("Next() Called");
    PageToggle.Organize(this.info.Bot.Toggles, 5, this.info.GuildID);
    this.OnceLoopEnabled = false;
    this.info.Player.errorCount = 0;
    this.info.Player.errorUrl = "";
    if(this.QueueLoopEnabled){
      this.default.push(this.default[0]);
    }else{
      if(this.info.AddRelative && this.info.Player.CurrentAudioInfo.ServiceIdentifer === "youtube"){
        const relatedVideos = (this.info.Player.CurrentAudioInfo as AudioSource.YouTube).relatedVideos;
        if(relatedVideos.length >= 1){
          const video = relatedVideos[0];
          await this.info.Queue.AddQueue(video.url, null, "push", "youtube", video);
        }
      }
    }
    this._default.shift();
    if(this.info.Bot.QueueModifiedGuilds.indexOf(this.info.GuildID) < 0){
      this.info.Bot.QueueModifiedGuilds.push(this.info.GuildID);
    }
  }

  /**
   * 指定された位置のキューコンテンツを削除します
   * @param offset 位置
   */
  RemoveAt(offset:number){
    this.Log("RemoveAt() Called (offset:" + offset + ")");
    PageToggle.Organize(this.info.Bot.Toggles, 5, this.info.GuildID);
    this._default.splice(offset, 1);
    if(this.info.Bot.QueueModifiedGuilds.indexOf(this.info.GuildID) < 0){
      this.info.Bot.QueueModifiedGuilds.push(this.info.GuildID);
    }
  }

  /**
   * すべてのキューコンテンツを消去します
   */
  RemoveAll(){
    this.Log("RemoveAll() Called");
    PageToggle.Organize(this.info.Bot.Toggles, 5, this.info.GuildID);
    this._default = [];
    if(this.info.Bot.QueueModifiedGuilds.indexOf(this.info.GuildID) < 0){
      this.info.Bot.QueueModifiedGuilds.push(this.info.GuildID);
    }
  }

  /**
   * 最初のキューコンテンツだけ残し、残りのキューコンテンツを消去します
   */
  RemoveFrom2(){
    this.Log("RemoveFrom2() Called");
    PageToggle.Organize(this.info.Bot.Toggles, 5, this.info.GuildID);
    this._default = [this.default[0]];
    if(this.info.Bot.QueueModifiedGuilds.indexOf(this.info.GuildID) < 0){
      this.info.Bot.QueueModifiedGuilds.push(this.info.GuildID);
    }
  }

  /**
   * キューをシャッフルします
   */
  Shuffle(){
    this.Log("Shuffle() Called");
    PageToggle.Organize(this.info.Bot.Toggles, 5, this.info.GuildID);
    if(this._default.length === 0) return;
    if(this.info.Player.IsPlaying || this.info.Player.preparing){
      const first = this._default[0];
      this._default.shift();
      this._default.sort(() => Math.random() - 0.5);
      this._default.unshift(first);
    }else{
      this._default.sort(() => Math.random() - 0.5);
    }
    if(this.info.Bot.QueueModifiedGuilds.indexOf(this.info.GuildID) < 0){
      this.info.Bot.QueueModifiedGuilds.push(this.info.GuildID);
    }
  }

  /**
   * 条件に一致するキューコンテンツをキューから削除します
   * @param validator 条件を表す関数
   * @returns 削除されたオフセットの一覧
   */
  RemoveIf(validator:(q:QueueContent)=>Boolean):number[]{
    this.Log("RemoveIf() Called");
    PageToggle.Organize(this.info.Bot.Toggles, 5, this.info.GuildID);
    if(this._default.length === 0) return [];
    const first = this.info.Player.IsPlaying ? 1 : 0
    const rmIndex = [] as number[];
    for(let i = first; i < this._default.length; i++){
      if(validator(this._default[i])){
        rmIndex.push(i);
      }
    }
    rmIndex.sort((a,b)=>b-a);
    rmIndex.forEach(n => this.RemoveAt(n));
    if(this.info.Bot.QueueModifiedGuilds.indexOf(this.info.GuildID) < 0){
      this.info.Bot.QueueModifiedGuilds.push(this.info.GuildID);
    }
    return rmIndex;
  }

  /**
   * キュー内で移動します
   * @param from 移動元のインデックス
   * @param to 移動先のインデックス
   */
  Move(from:number, to:number){
    this.Log("Move() Called");
    PageToggle.Organize(this.info.Bot.Toggles, 5, this.info.GuildID);
    if(from < to){
      //要素追加
      this.default.splice(to + 1, 0, this.default[from]);
      //要素削除
      this.default.splice(from, 1);
    }else if(from > to){
      //要素追加
      this.default.splice(to, 0, this.default[from]);
      //要素削除
      this.default.splice(from + 1, 1);
    }
    if(this.info.Bot.QueueModifiedGuilds.indexOf(this.info.GuildID) < 0){
      this.info.Bot.QueueModifiedGuilds.push(this.info.GuildID);
    }
  }

  /**
   * 追加者によってできるだけ交互になるようにソートします
   */
  SortWithAddedBy(){
    const count = this._default.length;
    // 追加者の一覧とマップを作成
    const addedByUsers = [] as string[];
    const queueByAdded = {} as {[key:string]:QueueContent[]};
    for(let i = 0; i < this._default.length; i++){
      if(!addedByUsers.includes(this._default[i].AdditionalInfo.AddedBy.userId)){
        addedByUsers.push(this._default[i].AdditionalInfo.AddedBy.userId);
        queueByAdded[this._default[i].AdditionalInfo.AddedBy.userId] = [this._default[i]];
      }else{
        queueByAdded[this._default[i].AdditionalInfo.AddedBy.userId].push(this._default[i]);
      }
    }
    // ソートをもとにキューを再構築
    const sorted = [] as QueueContent[];
    const maxLengthByUser = Math.max(...addedByUsers.map(user => queueByAdded[user].length))
    for(let i = 0; i < maxLengthByUser; i++){
      sorted.push(...addedByUsers.map(user => queueByAdded[user][i]).filter(q => !!q));
    }
    this._default = sorted;
  }
}

/**
 * キューの内容を示します
 */
type QueueContent = {
  /**
   * 曲自体のメタ情報
   */
  BasicInfo:AudioSource.AudioSource;
  /**
   * 曲の情報とは別の追加情報
   */
  AdditionalInfo:AdditionalInfo;
}

type AddedBy = {
  /**
   * 曲の追加者の表示名。表示名は追加された時点での名前になります。
   */
  displayName:string,
  /**
   * 曲の追加者のユーザーID
   */
  userId:string
};

/**
 * 曲の情報とは別の追加情報を示します。
 */
type AdditionalInfo = {
  /**
   * 曲の追加者を示します
   */
  AddedBy: AddedBy,
}
