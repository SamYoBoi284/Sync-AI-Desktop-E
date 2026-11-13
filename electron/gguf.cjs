const fs = require("node:fs");
const MAX_ENTRIES = 100000, MAX_TENSORS = 10000000, MAX_STRING = 1024 * 1024, MAX_ARRAY = 10000000;
const QUANT = ["F32","F16","Q4_0","Q4_1",null,null,null,"Q8_0","Q5_0","Q5_1","Q2_K","Q3_K_S","Q3_K_M","Q3_K_L","Q4_K_S","Q4_K_M","Q5_K_S","Q5_K_M","Q6_K","IQ2_XXS","IQ2_XS","Q2_K_S","IQ3_XS","IQ3_XXS","IQ1_S","IQ4_NL","IQ3_S","IQ3_M","IQ2_S","IQ2_M","IQ4_XS","IQ1_M","BF16",null,null,null,"TQ1_0","TQ2_0","MXFP4_MOE","NVFP4","Q1_0","Q2_0","F8_E4M3"];

class Reader {
  constructor(file) { this.fd=fs.openSync(file,"r"); this.size=fs.fstatSync(this.fd).size; this.pos=0; }
  read(n) { if(!Number.isSafeInteger(n)||n<0||this.pos+n>this.size) throw Error("GGUF metadata is truncated or contains an out-of-range length."); const b=Buffer.alloc(n); const got=fs.readSync(this.fd,b,0,n,this.pos); if(got!==n) throw Error("Truncated GGUF value."); this.pos+=n; return b; }
  skip(n) { if(!Number.isSafeInteger(n)||n<0||this.pos+n>this.size) throw Error("GGUF metadata is truncated or contains an out-of-range length."); this.pos+=n; }
  u8(){return this.read(1).readUInt8(0);}
  u16(){return this.read(2).readUInt16LE(0);}
  u32(){return this.read(4).readUInt32LE(0);}
  i32(){return this.read(4).readInt32LE(0);}
  u64(){const n=this.read(8).readBigUInt64LE(0);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error("GGUF metadata length exceeds the supported range.");return Number(n);}
  i64(){const n=this.read(8).readBigInt64LE(0);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))throw Error("GGUF metadata integer exceeds the supported range.");return Number(n);}
  str(){const n=this.u64();if(n>MAX_STRING)throw Error("GGUF metadata string exceeds the safety limit.");return new TextDecoder("utf-8",{fatal:true}).decode(this.read(n));}
  array(){const type=this.u32(),count=this.u64();if(count>MAX_ARRAY||type===9||type>12)throw Error("GGUF metadata array exceeds the safety limit or uses an unsupported nested type.");if(type===8){for(let i=0;i<count;i++){const n=this.u64();if(n>MAX_STRING)throw Error("GGUF metadata string exceeds the safety limit.");this.skip(n);}return;}const widths={0:1,1:1,7:1,2:2,3:2,4:4,5:4,6:4,10:8,11:8,12:8};const width=widths[type];if(!width)throw Error("GGUF metadata array element type is invalid.");this.skip(count*width);}
  close(){try{fs.closeSync(this.fd);}catch{}}
}
function readValue(r,type,capture){
  switch(type){
    case 0: case 1: case 7: return capture?r.u8():(r.skip(1),null);
    case 2: case 3: return capture?r.u16():(r.skip(2),null);
    case 4: return capture?r.u32():(r.skip(4),null);
    case 5: return capture?r.i32():(r.skip(4),null);
    case 6: r.skip(4);return null;
    case 8: return capture?r.str():(()=>{const n=r.u64();if(n>MAX_STRING)throw Error("GGUF metadata string exceeds the safety limit.");r.skip(n);return null;})();
    case 9: r.array();return null;
    case 10: return capture?r.u64():(r.skip(8),null);
    case 11: return capture?r.i64():(r.skip(8),null);
    case 12: r.skip(8);return null;
    default: throw Error("GGUF metadata contains unknown value type "+type+".");
  }
}
function readGgufMetadata(filePath){
  const r=new Reader(filePath);
  try{
    if(r.size<24)throw Error("The selected file is too small to contain a GGUF header.");
    if(r.read(4).toString("ascii")!=="GGUF")throw Error("The selected file does not contain a valid GGUF magic header.");
    const version=r.u32();if(version!==2&&version!==3)throw Error("GGUF version "+version+" is not supported. Supported versions are 2 and 3.");
    const tensors=r.u64(),count=r.u64();if(!tensors||tensors>MAX_TENSORS)throw Error("GGUF tensor count is invalid or exceeds the safety limit.");if(count>MAX_ENTRIES)throw Error("GGUF metadata entry count exceeds the safety limit.");
    const values=new Map();
    for(let i=0;i<count;i++){
      const key=r.str(),type=r.u32();
      const capture=key==="general.architecture"||key==="general.name"||key==="general.file_type"||[".block_count",".attention.head_count",".attention.head_count_kv",".embedding_length",".attention.key_length",".attention.value_length",".context_length"].some(s=>key.endsWith(s));
      const value=readValue(r,type,capture);if(capture&&value!==null)values.set(key,value);
    }
    const architecture=values.get("general.architecture");
    if(typeof architecture!=="string"||!architecture)throw Error("GGUF metadata is missing general.architecture.");
    const suffix=s=>values.get(architecture+s)??null;
    const ft=values.get("general.file_type");
    return {architecture,modelName:values.get("general.name")||null,quantization:Number.isInteger(ft)?(QUANT[ft]||null):null,
      layerCount:suffix(".block_count"),attentionHeads:suffix(".attention.head_count"),kvHeads:suffix(".attention.head_count_kv"),
      embeddingLength:suffix(".embedding_length"),keyLength:suffix(".attention.key_length"),valueLength:suffix(".attention.value_length"),
      trainingContextLength:suffix(".context_length"),version,tensorCount:tensors};
  } finally {r.close();}
}
function estimatePeakBytes(meta,size){
  const safe=(n)=>Number.isSafeInteger(n)&&n>0?n:0;
  const layers=safe(meta.layerCount),kv=safe(meta.kvHeads||meta.attentionHeads),embedding=safe(meta.embeddingLength);
  let cache;
  if(layers&&kv&&embedding){const heads=safe(meta.attentionHeads)||kv,head=safe(meta.keyLength)||Math.max(1,Math.floor(embedding/heads)),value=safe(meta.valueLength)||head;cache=2048*layers*kv*(head+value)*2;}
  else cache=Math.floor(size/5)+512*1024*1024;
  const scratch=(embedding||4096)*128*8;
  return size+Math.floor(size/5)+cache+scratch+384*1024*1024;
}
module.exports={readGgufMetadata,estimatePeakBytes};
