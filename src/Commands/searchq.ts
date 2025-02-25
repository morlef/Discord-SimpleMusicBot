import * as discord from "discord.js";
import { CommandArgs, BaseCommand, SlashCommandArgument } from ".";
import { YouTube } from "../AudioSource";
import { CommandMessage } from "../Component/CommandMessage"
import { getColor } from "../Util/colorUtil";
import { CalcMinSec, log } from "../Util";

export default class Searchq extends BaseCommand {
  constructor(){
    super({
      name: "キュー内を検索",
      alias: ["searchq", "seq", "sq"],
      description: "キュー内を検索します。引数にキーワードを指定します。",
      unlist: false,
      category: "playlist",
      examples: "seq milk boy",
      usage: "seq <キーワード>",
      argument: [{
        type: "string",
        name: "keyword",
        description: "検索したい楽曲のキーワード",
        required: true
      }]
    });
  }

  async run(message:CommandMessage, options:CommandArgs){
    options.updateBoundChannel(message);
    if(options.data[message.guild.id].Queue.length === 0){
      message.reply(":gantan: キューが空です").catch(e => log(e, "error"));
      return;
    }
    let qsresult = options.data[message.guild.id].Queue
                    .filter(c => c.BasicInfo.Title.toLowerCase().indexOf(options.rawArgs.toLowerCase()) >= 0)
                    .concat(
                      options.data[message.guild.id].Queue
                      .filter(c => c.BasicInfo.Url.toLowerCase().indexOf(options.rawArgs.toLowerCase()) >= 0)
                    );
    if(qsresult.length === 0){
      message.reply(":confused:見つかりませんでした").catch(e => log(e, "error"));
      return;
    }
    if(qsresult.length > 20) qsresult = qsresult.slice(0,20);
    const fields = qsresult.map(c => {
      const index = options.data[message.guild.id].Queue.findIndex(d => d.BasicInfo.Title === c.BasicInfo.Title).toString()
      const _t = c.BasicInfo.LengthSeconds;
      const [min,sec] = CalcMinSec(_t);
      return {
        name: index === "0" ? "現在再生中/再生待ち" : index,
        value: "[" + c.BasicInfo.Title + "](https://discord.gg/krtnftmmmtmt)\r\nリクエスト: `" + c.AdditionalInfo.AddedBy.displayName + "` \r\n長さ: " + ((c.BasicInfo.ServiceIdentifer === "youtube" && (c.BasicInfo as YouTube).LiveStream) ? "(ライブストリーム)" : " `" + (_t === 0 ? "(不明)" : min + ":" + sec + "`")),
        inline: false
      } as discord.EmbedField
    });
    const embed = new discord.MessageEmbed();
    embed.title = "\"" + options.rawArgs + "\"の検索結果✨";
    embed.description = "キュー内での検索結果です。最大20件表示されます。";
    embed.fields = fields;
    embed.setColor(getColor("SEARCH"));
    message.reply({embeds:[embed]});
  }
}