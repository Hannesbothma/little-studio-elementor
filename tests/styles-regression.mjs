import { PHP } from "@php-wasm/universal";
import { loadNodeRuntime } from "@php-wasm/node";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const php = new PHP(
  await loadNodeRuntime(process.env.LSE_TEST_PHP || "8.3", {
    emscriptenOptions: { processId: 1 },
  }),
);
try {
  php.writeFile("/styles.php", await readFile("includes/styles.php"));
  const result = await php.run({
    code: `<?php
    define('ABSPATH','/'); define('LSE_VERSION','test');
    $GLOBALS['baseurl']='https://destination.example/uploads';
    $GLOBALS['uploads_error']=''; $GLOBALS['writable']=true;
    function wp_upload_dir(){return ['basedir'=>'/uploads','baseurl'=>$GLOBALS['baseurl'],'error'=>$GLOBALS['uploads_error']];}
    function home_url(){return 'https://destination.example';}
    function wp_parse_url($url,$part){return parse_url($url,$part);}
    function absint($n){return abs((int)$n);}
    function wp_mkdir_p($path){return $GLOBALS['writable'] && (is_dir($path)||mkdir($path,0755,true));}
    function wp_tempnam($name,$directory){return tempnam($directory,'lse');}
    function wp_delete_file($path){unlink($path);}
    function wp_enqueue_style($handle,$src=null,$deps=[],$version=null){$GLOBALS['enqueued']=[$handle,$src,$version];}
    function wp_register_style(){}
    function wp_add_inline_style($handle,$css){$GLOBALS['inline']=$css;}
    require '/styles.php';
    function check($ok,$message){if(!$ok)throw new RuntimeException($message);}
    $css='.hero{background:url("https://destination.example/photo.jpg");color:red}';
    LSE_Styles::enqueue(12,$css);
    $asset=$GLOBALS['enqueued'][1];
    check(str_contains($asset,hash('sha256',$css)), 'Stylesheet must be content-versioned');
    check(file_get_contents('/uploads/little-studio-styles/'.basename($asset))===$css,'Stylesheet content changed');
    check((fileperms('/uploads/little-studio-styles/'.basename($asset))&0444)===0444,'Stylesheet is not readable by the web server');
    check(LSE_Styles::asset(12,$css.'p{color:blue}')['url']!==$asset,'Changed CSS reused stale asset');
    foreach(['.a{fill:url(#paint)}','.a{background:url(../photo.jpg)}','.a{background:url(/photo.jpg)}','@import "theme.css";p{color:red}']as$i=>$relative){
      unset($GLOBALS['inline']);LSE_Styles::enqueue(20+$i,$relative);
      check(($GLOBALS['inline']??null)===$relative,'Document-relative CSS lost inline delivery');
    }
    $GLOBALS['baseurl']='https://cdn.example/uploads';
    check(LSE_Styles::asset(30,$css)===false,'Remote offloaded uploads used a local asset');
    $GLOBALS['baseurl']='https://destination.example/uploads';$GLOBALS['writable']=false;
    check(LSE_Styles::asset(31,$css)===false,'Unwritable uploads did not fall back');
    echo json_encode(['cachedCSSExact'=>true,'versionedChanges'=>true,'documentRelativeFallback'=>true,'offloadFallback'=>true,'unwritableFallback'=>true]);
  `,
  });
  assert.equal(result.exitCode, 0, result.errors);
  console.log(result.text);
} finally {
  php.exit();
}
