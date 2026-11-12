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
  php.writeFile("/fetch.php", await readFile("includes/fetch.php"));
  const r = await php.run({
    code: `<?php
namespace WpOrg\\Requests { class Response {public $body='body';public $status_code=200;public $headers=[];}class Requests {public static function request_multiple($requests){$GLOBALS['requests']=$requests;$out=[];foreach($requests as$url=>$item){if($item['options']['follow_redirects']!==false||!is_string($item['options']['verify']))throw new \\RuntimeException('Redirect/TLS policy changed');$out[$url]=new Response();if(str_contains($url,'redirect')){$out[$url]->status_code=302;$out[$url]->headers=['location'=>'http://127.0.0.1/private'];}}return $out;}} }
namespace { define('ABSPATH','/wp/');define('WPINC','wp-includes');define('LSE_VERSION','test');if(!function_exists('curl_multi_exec')){function curl_multi_exec(){}}
class WP_HTTP_Proxy{public function is_enabled(){return false;}}
class WP_HTTP_Requests_Hooks{public function __construct($url,$args){}}
class WP_HTTP_Requests_Response{private $r;public function __construct($r){$this->r=$r;}public function to_array(){return ['body'=>$this->r->body,'headers'=>$this->r->headers,'response'=>['code'=>$this->r->status_code],'cookies'=>[]];}}
class WP_Error{public function __construct(...$args){}}
function _wp_http_get_object(){return new class{public function block_request($url){return false;}};}
function has_filter($name){return $GLOBALS['custom']??false;}
function apply_filters($hook,$value,...$args){if($hook==='http_response'){$GLOBALS['filtered']=($GLOBALS['filtered']??0)+1;return $value;}if($hook==='pre_http_request'&&str_contains($args[1],'intercepted'))return ['body'=>'intercepted'];return $value;}
function do_action(...$args){}
function wp_safe_remote_get($url,$args){$GLOBALS['fallback']=($GLOBALS['fallback']??0)+1;return ['body'=>'fallback','url'=>$url,'args'=>$args];}
require '/fetch.php';function check($ok,$name){if(!$ok)throw new RuntimeException($name);}
$validate=static function($url){if(str_contains($url,'unsafe'))throw new RuntimeException('Unsafe URL');};
LSE_Fetch::prime(['https://public.example/a','https://unsafe.example/x','https://public.example/b','https://public.example/redirect','https://public.example/not-started'],$validate);
check(count($GLOBALS['requests'])===3,'Unsafe or excess resource was fetched');check(($GLOBALS['filtered']??0)===3,'WP response filters missing');check(LSE_Fetch::get('https://public.example/redirect')['response']['code']===302,'Redirect was followed');check(LSE_Fetch::get('https://public.example/a')['body']==='body','Prefetch missing');check(LSE_Fetch::get('https://public.example/a')['body']==='fallback','Response was consumed twice');
LSE_Fetch::prime(['https://public.example/intercepted'],$validate);check(LSE_Fetch::get('https://public.example/intercepted')['body']==='intercepted','WP interception ignored');$GLOBALS['custom']=true;check(LSE_Fetch::concurrency()===1,'Custom HTTP handling did not select fallback');LSE_Fetch::prime(['https://public.example/custom'],$validate);$fallback=LSE_Fetch::get('https://public.example/custom');check($fallback['body']==='fallback'&&$fallback['args']['redirection']===0,'Custom host route lost');
echo json_encode(['publicOnlyPrefetch'=>true,'fourResourceBound'=>true,'noRedirectFollowing'=>true,'tlsVerification'=>true,'wordPressHooks'=>true,'consumeOnce'=>true,'customHostFallback'=>true]); }
`,
  });
  assert.equal(r.exitCode, 0, r.errors);
  console.log(r.text);
} finally {
  php.exit();
}
