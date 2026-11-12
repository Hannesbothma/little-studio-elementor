// Dismiss only Elementor's installation promotion through its normal Close control.
// It appears after the third editor visit on a new site; never install Angie.
export async function handleEditorPrompts(page, hoverTarget) {
 const announcement=page.locator('#e-announcements-root .announcements-container').filter({hasText:'Discover your new superpowers'});
 await page.addLocatorHandler(announcement,async container=>{
  await page.locator('#elementor-loading').waitFor({state:'hidden',timeout:90000});
  await container.locator('button.close-button').click();
  if(hoverTarget&&await hoverTarget.isVisible())await hoverTarget.hover();
 });
 const promotion=page.getByRole('dialog').filter({hasText:'Ask Angie to build you full pages'});
 await page.addLocatorHandler(promotion,async dialog=>{
  // Wait for the editor's own loader; a visible promotion can sit underneath it.
  await page.locator('#elementor-loading').waitFor({state:'hidden',timeout:90000});
  await dialog.getByRole('button',{name:'Close',exact:true}).click({timeout:90000});
  // Closing moves the pointer off the canvas. Restore hover for its edit toolbar.
  if(hoverTarget&&await hoverTarget.isVisible())await hoverTarget.hover();
 });
}
