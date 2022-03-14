import { CommandArgs, CommandInterface } from ".";
import { CommandMessage } from "../Component/CommandMessage"
import { config, log } from "../Util";

export default class Tts implements CommandInterface {
  name = "読み上げ";
  alias = ["tts"];
  unlist = true;
  async run(message:CommandMessage, options:CommandArgs){
    if(!config.tts){
      await message.reply("TTSは無効になっているため使用できません").catch(e => log(e, "error"));
      return;
    }
    const guild = options.data[message.guild.id];
    if(!guild.Player.IsConnecting){
      await message.reply("ボイスチャンネルに接続されていません").catch(e => log(e, "error"));
      return;
    }
    if(guild.enableTts){
      guild.enableTts = false;
      guild.Queue.RemoveAll();
      await message.reply(":x:現在のセッションでTTSを無効にしました").catch(e => log(e, "error"));
    }else{
      guild.enableTts = true;
      guild.Queue.RemoveAll();
      await message.reply(":o:現在のセッションでTTSを有効にしました:white_check_mark:").catch(e => log(e, "error"));
    }
  }
}