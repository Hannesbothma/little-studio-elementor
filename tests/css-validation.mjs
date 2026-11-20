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
  for (const f of [
    "errors",
    "css",
    "native-elementor",
    "page-save",
    "management",
    "background-import",
    "theme-parts",
    "importer",
  ])
    php.writeFile("/" + f + ".php", await readFile("includes/" + f + ".php"));
  const result = await php.run({
    code: `<?php define('ABSPATH','/');require '/errors.php';require '/css.php';require '/native-elementor.php';require '/page-save.php';require '/management.php';require '/background-import.php';require '/theme-parts.php';require '/importer.php';
function current_user_can($cap){return true;}
function check($v,$label){if(!$v)throw new RuntimeException($label);}
$valid=['a[href^="javascript:"]:after{content:""}','/* @import and expression( are documentation */.x{content:"javascript:; @import";color:red}','.x{transition-behavior:allow-discrete;background:url("https://example.com/a.png")}','@media print{a[href^="javascript:"]::after{content:""}}'];
foreach($valid as $css)check(LSE_CSS::clean($css)===$css,'Safe CSS was altered or rejected');
$invalid=['.x{color:red;background:url(javascript:evil);padding:8px}', '.x{background:u\\\\72l("\\\\6a avascript:evil")}', '.x{width:e\\\\78pression(alert(1))}', '.x{behavior:url(x.htc)}', '@import "https://example.com/a.css";p{color:red}', '.x{content:"</style><script>"}'];
$invalid[]='.x{background:image-set("javascript:bad" 1x)}';$invalid[]='.x{background:src("javascript:bad")}';
foreach($invalid as $css){$issues=LSE_CSS::inspect($css);check(count($issues)>0,'Unsafe CSS was accepted:'.$css);check($issues[0]['line']===1&&$issues[0]['column']>0,'Missing location');$skipped=[];$clean=LSE_CSS::clean($css,'css',array_column(array_column($issues,'skip'),'id'),$skipped);check(!LSE_CSS::inspect($clean),'Unsafe skipped content remained');}
$css=".hero{color:red;\\n background:url(javascript:evil);padding:8px} .other{color:blue}";$issue=LSE_CSS::inspect($css)[0];check($issue['line']===2,'Wrong line');$skipped=[];$clean=LSE_CSS::clean($css,'css',[$issue['skip']['id']],$skipped);check(str_contains($clean,'color:red')&&str_contains($clean,'padding:8px')&&str_contains($clean,'.other{color:blue}'),'Skip lost unrelated CSS');
$literal='.x{content:"/*</style>*/";color:red}';$literalIssue=LSE_CSS::inspect($literal)[0];$literalSkip=[];$literalClean=LSE_CSS::clean($literal,'css',[$literalIssue['skip']['id']],$literalSkip);check($literalClean==='.x{color:red}','A comment-looking string was mistaken for a CSS comment');
$unicode=LSE_CSS::inspect('.é{background:url("javascript:bad")}')[0];check($unicode['column']===15,'Unicode column was not precise');
$malformed=LSE_CSS::inspect('.x{background:url("javascript:bad"');check(count($malformed)===1&&!$malformed[0]['recoverable'],'Unbalanced unsafe CSS must not be silently accepted or blindly skipped');
eval('namespace Elementor\\Modules\\Promotions\\Widgets; class Pro_Widget_Promotion {} namespace Elementor; class Widget_Pro {} class Plugin { public static $instance; }');
\\Elementor\\Plugin::$instance=(object)['widgets_manager'=>new class{public function get_widget_types(){return ['heading'=>new \\stdClass(),'slides'=>new \\Elementor\\Modules\\Promotions\\Widgets\\Pro_Widget_Promotion(),'gallery'=>new \\Elementor\\Widget_Pro()];}}];check(array_keys(LSE_Native::widgets())===['heading'],'Locked Pro promotions were counted as working widgets');
$unavailable=false;try{LSE_Native::element(['elType'=>'widget','widgetType'=>'slides']);}catch(RuntimeException $e){$unavailable=str_contains($e->getMessage(),'unavailable');}check($unavailable,'Locked Pro placeholder was accepted');
$nativeCSS='selector{color:red;background:url(javascript:bad);padding:4px}';$field='elements.abcdef2.settings.custom_css';$nativeIssue=LSE_CSS::inspect($nativeCSS,$field)[0];$nativeSkip=[];$nativeCount=0;
$tree=new ReflectionMethod('LSE_Importer','tree');$tree->setAccessible(true);$job=['assets'=>[],'map'=>[]];
$items=[['id'=>'abcdef1','elType'=>'container','settings'=>[],'elements'=>[['id'=>'abcdef2','elType'=>'container','settings'=>['custom_css'=>$nativeCSS],'elements'=>[]]]]];
$args=[$items,$job,&$nativeCount,0,true,[$nativeIssue['skip']['id']],&$nativeSkip];$cleanTree=$tree->invokeArgs(null,$args);check(count($nativeSkip)===1,'Native tree lost the omission report');$cleanNative=$cleanTree[0]['elements'][0]['settings']['custom_css'];check($cleanNative==='selector{color:red;padding:4px}','Native tree skip did not isolate the failing declaration');
$pageField='page_settings.custom_css';$pageIssue=LSE_CSS::inspect($nativeCSS,$pageField)[0];$cleanSettings=LSE_Native::settings(['custom_css'=>$nativeCSS],$job,'page_settings',[$pageIssue['skip']['id']],$nativeSkip);check(count($nativeSkip)===2&&$cleanSettings['custom_css']===$cleanNative,'Native page settings lost granular skipping or prior omissions');
$large='/*' .str_repeat('x',17*1024*1024).'*/.x{color:red}';check(LSE_CSS::clean($large)===$large,'Large CSS changed');echo json_encode(['cssContextValidation'=>true,'greenValleyPrintSelector'=>true,'escapedUnsafeValues'=>true,'granularSkip'=>true,'largeCSS'=>true,'nativeNestedCSSSkip'=>true,'nativePageCSSSkip'=>true,'lockedProWidgetsRejected'=>true]);`,
  });
  assert.equal(result.exitCode, 0, result.errors);
  console.log(result.text);
} finally {
  php.exit();
}
