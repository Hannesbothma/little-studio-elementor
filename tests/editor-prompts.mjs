// Dismiss only Elementor's installation promotion through its normal Close control.
// It appears after the third editor visit on a new site; never install Angie.
export async function handleEditorPrompts(page, hoverTarget) {
 const promotion=page.getByRole('dialog').filter({hasText:'Ask Angie to build you full pages'});
 await page.addLocatorHandler(promotion,async dialog=>{
  await dialog.getByRole('button',{name:'Close',exact:true}).click();
  // Closing moves the pointer off the canvas. Restore hover for its edit toolbar.
  if(hoverTarget&&await hoverTarget.isVisible())await hoverTarget.hover();
 });
}
