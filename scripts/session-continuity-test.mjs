#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function root() {
  const configured = (process.env.CADGPT_APPDATA_ROOT || "").trim();
  if (configured && configured.toLowerCase() !== "appdata") return path.resolve(configured);
  if (process.platform === "win32" && process.env.LOCALAPPDATA) return path.resolve(process.env.LOCALAPPDATA, "CadGPT");
  return path.resolve(os.homedir(), ".local", "share", "CadGPT");
}

const appRoot=root();
const log=path.join(appRoot,"logs","continuity.ndjson");
const checkpoints=path.join(appRoot,"logs","session-continuity-checkpoints.ndjson");

function readNdjson(file){
  if(!fs.existsSync(file)) return [];
  return fs.readFileSync(file,"utf8").split(/\r?\n/).filter(Boolean).flatMap(line=>{
    try{return [JSON.parse(line)]}catch{return []}
  });
}

function latest(){
  return readNdjson(log)
    .filter(r=>r?.event==="request_received")
    .filter(r=>r?.header_fingerprints?.["x-openai-session"])
    .at(-1)||null;
}

function capture(label){
  const r=latest();
  if(!r){
    console.error("No CadGPT request with x-openai-session found. Invoke CG once, then retry.");
    process.exit(2);
  }
  const h=r.header_fingerprints||{};
  const row={
    label,
    captured_at:new Date().toISOString(),
    source_timestamp:r.timestamp,
    runtime_id:r.runtime_id||null,
    x_openai_session_fp:h["x-openai-session"]||null,
    x_openai_subject_fp:h["x-openai-subject"]||null,
    mcp_session_fp:r.transport_session||null,
    rpc_method:r.rpc_method||null,
    tool_name:r.tool_name||null
  };
  fs.mkdirSync(path.dirname(checkpoints),{recursive:true});
  fs.appendFileSync(checkpoints,JSON.stringify(row)+"\n","utf8");
  console.log(JSON.stringify(row,null,2));
}

function report(){
  const rows=readNdjson(checkpoints);
  if(!rows.length){
    console.error("No checkpoints. Capture t0 first.");
    process.exit(2);
  }
  const base=rows[0];
  console.log("CadGPT ChatGPT conversation continuity");
  console.log("======================================");
  for(const r of rows){
    const same=r.x_openai_session_fp===base.x_openai_session_fp;
    const subjectSame=r.x_openai_subject_fp===base.x_openai_subject_fp;
    const transportSame=r.mcp_session_fp===base.mcp_session_fp;
    console.log([
      String(r.label).padEnd(20),
      (same?"SAME_CHAT_ID":"DIFFERENT_CHAT_ID").padEnd(18),
      ("session="+(r.x_openai_session_fp||"-")).padEnd(26),
      ("subject="+(subjectSame?"same":"different")).padEnd(20),
      "transport="+(transportSame?"same":"rotated")
    ].join(" "));
  }
}

function reset(){
  fs.mkdirSync(path.dirname(checkpoints),{recursive:true});
  if(fs.existsSync(checkpoints)) fs.rmSync(checkpoints);
  console.log("Reset checkpoints. Persistent continuity fingerprint key is preserved.");
}

const [cmd,label]=process.argv.slice(2);
if(cmd==="capture") capture(label||"checkpoint");
else if(cmd==="report") report();
else if(cmd==="reset") reset();
else {
  console.log("Usage:");
  console.log("  node scripts/session-continuity-test.mjs reset");
  console.log("  node scripts/session-continuity-test.mjs capture t0");
  console.log("  node scripts/session-continuity-test.mjs capture 1h");
  console.log("  node scripts/session-continuity-test.mjs capture 4h");
  console.log("  node scripts/session-continuity-test.mjs capture 8h");
  console.log("  node scripts/session-continuity-test.mjs capture control-new-chat");
  console.log("  node scripts/session-continuity-test.mjs report");
}
