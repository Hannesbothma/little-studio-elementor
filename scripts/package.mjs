import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {deflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const source=resolve(process.argv[2]||'.'),target=resolve(process.argv[3]||'dist');
const main=await readFile(join(source,'little-studio-elementor.php'),'utf8');
const version=main.match(/^\s*\* Version:\s*(\d+\.\d+\.\d+)\s*$/m)?.[1];
if(!version||!main.includes("define( 'LSE_VERSION', '"+version+"' )"))throw Error('Plugin header/constant versions must match.');
if(process.env.RELEASE_TAG&&process.env.RELEASE_TAG!=='v'+version)throw Error('Release tag does not match the plugin version.');
if(process.env.GITHUB_REF_TYPE==='tag'&&process.env.GITHUB_REF_NAME!=='v'+version)throw Error('Release tag does not match the plugin version.');
const selected=['little-studio-elementor.php','readme.txt','LICENSE.txt'];
async function walk(dir){for(const e of(await readdir(join(source,dir),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=dir+'/'+e.name;if(e.isDirectory())await walk(p);else if(e.isFile())selected.push(p);else throw Error('Links are not allowed in release packages.');}}
await walk('assets');await walk('includes');selected.sort();
const table=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc=b=>{let n=0xffffffff;for(const byte of b)n=table[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
const chunks=[],central=[];let offset=0;
for(const relative of selected){const body=await readFile(join(source,relative)),compressed=deflateRawSync(body,{level:9}),name=Buffer.from('little-studio-elementor/'+relative),checksum=crc(body),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(0x5021,12);local.writeUInt32LE(checksum,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);chunks.push(local,name,compressed);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt16LE(8,10);c.writeUInt16LE(0x5021,14);c.writeUInt32LE(checksum,16);c.writeUInt32LE(compressed.length,20);c.writeUInt32LE(body.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=local.length+name.length+compressed.length;}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(selected.length,8);end.writeUInt16LE(selected.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);const archive=Buffer.concat([...chunks,directory,end]);
const name='little-studio-elementor-'+version+'.zip',sha256=createHash('sha256').update(archive).digest('hex');
const manifest={name:'Little Studio to Elementor',version,package:'https://github.com/Hannesbothma/little-studio-elementor/releases/download/v'+version+'/'+name,sha256,bytes:archive.length,requires:main.match(/Requires at least:\s*([\d.]+)/)?.[1]||'6.8',requires_php:main.match(/Requires PHP:\s*([\d.]+)/)?.[1]||'8.0',tested:'7.1.4',notes:'Faster batched capture and importing, a simpler website-link form, and support for deeply nested editable layouts.'};
await mkdir(target,{recursive:true});await writeFile(join(target,name),archive);await writeFile(join(target,'update.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({version,name,bytes:archive.length,sha256,files:selected.length}));
