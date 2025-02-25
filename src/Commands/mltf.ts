import { CommandArgs, BaseCommand } from ".";
import { CommandMessage } from "../Component/CommandMessage"
import { log } from "../Util";

export default class Mltf extends BaseCommand {
  constructor(){
    super({
      name: "最後の曲を先頭へ",
      alias: ["movelastsongtofirst", "mlstf", "ml", "mltf", "mlf", "m1"],
      description: "キューの最後の曲をキューの先頭に移動します。",
      unlist: false,
      category: "playlist",
    })
  }

  async run(message:CommandMessage, options:CommandArgs){
    options.updateBoundChannel(message);
    if(options.data[message.guild.id].Queue.length <= 2){
      message.reply("キューに3曲以上追加されているときに使用できます。").catch(e=>log(e, "error"));
      return;
    }
    const q = options.data[message.guild.id].Queue;
    const to = options.data[message.guild.id].Player.IsPlaying ? 1 : 0;
    q.Move(q.length - 1, to);
    const info = q.get(to);
    message.reply("✅`" + info.BasicInfo.Title + "`を一番最後からキューの先頭に移動しました").catch(e => log(e, "error"));
  }
}
