import{PHP}from'@php-wasm/universal';import{loadNodeRuntime}from'@php-wasm/node';import{readFile,readdir}from'node:fs/promises';import assert from'node:assert/strict';
const php=new PHP(await loadNodeRuntime('8.3',{emscriptenOptions:{processId:1}}));
try{
 for(const file of await readdir('includes'))if(file.endsWith('.php'))php.writeFile('/'+file,await readFile('includes/'+file));
 const r=await php.run({code:`<?php
define('ABSPATH','/');foreach(glob('/*.php')as$file)token_get_all(file_get_contents($file),TOKEN_PARSE);require '/page-save.php';require '/management.php';require '/importer.php';
$m=new ReflectionMethod('LSE_Importer','rewrite');$m->setAccessible(true);$warnings=[];set_error_handler(function($n,$text)use(&$warnings){$warnings[]=$text;return true;});
$check=function($input,$map,$expected)use($m){$actual=$m->invoke(null,$input,$map);if($actual!==$expected)throw new RuntimeException('Resource replacement changed content or returned a non-string');};
$map=[];for($i=0;$i<148;$i++){$key='https://little-studio-assets.invalid/capture/'.hash('sha256','resource-'.$i).'.jpg';$map[$key]='https://destination.example/wp-content/uploads/resource-'.$i.'.jpg';}
foreach($map as$from=>$to){$check('url("'.$from.'")',$map,'url("'.$to.'")');$check(str_replace('/','\\\\/',$from),$map,str_replace('/','\\\\/',$to));$check($from.'-extra',$map,$from.'-extra');$check($from.'#part',$map,$to.'#part');}
$first=array_key_first($map);$map[$first.'?variant=2']='https://destination.example/variant.jpg';$check($first.'?variant=2',$map,'https://destination.example/variant.jpg');
$map[$first]='https://tiny/';$map['https://tiny/']='https://final/';$check($first,$map,'https://tiny/');$check(['image'=>['url'=>$first],'size'=>24],$map,['image'=>['url'=>'https://tiny/'],'size'=>24]);
$cross=['?b?c?d'=>'B','?c?d'=>'C','a?b'=>'A'];for($i=0;$i<500;$i++){$cross['p'.str_pad($i,4,'0',STR_PAD_LEFT)]='unused';$cross['q'.str_pad($i,3,'0',STR_PAD_LEFT)]='unused';}$check('a?b?c?d',$cross,'AC');
$long=[];for($i=0;$i<512;$i++){$long['https://long.example/'.str_repeat('x',1000).'/'.$i]='https://new.example/'.$i;}$check(array_key_last($long),$long,'https://new.example/511');
if($warnings)throw new RuntimeException(implode('; ',$warnings));restore_error_handler();echo json_encode(['rewriteRegression'=>true,'resources'=>148,'longURLs'=>512,'longestMatch'=>true,'noCascading'=>true,'escapedURLs'=>true,'overlappingChunks'=>true,'phpSyntax'=>true]);`});assert.equal(r.exitCode,0,r.errors);console.log(r.text);
}finally{php.exit();}
