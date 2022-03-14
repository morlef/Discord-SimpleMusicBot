import * as fs from "fs";
import * as path from "path";
import CJSON, { CommentObject } from "comment-json";

type ConfigJson = {
  adminId: string, 
  debug: boolean, 
  maintenance: boolean, 
  errorChannel: string, 
  proxy: string,
  prefix:string,
  tts:boolean,
}

const config = {
  prefix: ">",
  tts: false,
  ...(CJSON.parse(fs.readFileSync(path.join(__dirname, "../../config.json"), {encoding: "utf-8"})) as CommentObject)
} as ConfigJson;

if(![
  config.adminId === null || typeof config.adminId === "string",
  typeof config.debug === "boolean",
  config.errorChannel === null || typeof config.errorChannel === "string",
  typeof config.maintenance === "boolean",
  config.proxy === null || typeof config.proxy === "string",
  typeof config.prefix === "string",
  config.prefix === null || config.prefix.length === 1,
  (typeof config.tts === "boolean" || config.tts === undefined),
].every(test => test)){
  throw new Error("Invalid config.json");
}

export default config;