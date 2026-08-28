function setupStandalone() {
  const props = PropertiesService.getScriptProperties();
  const values = {
    SPREADSHEET_ID: '1tjzjNqHEnPkzQGqB_ydxdWSKsdth27IUJaRrm_5xGks',
    NOTION_DATA_SOURCE_ID: props.getProperty('NOTION_DATA_SOURCE_ID') || DEFAULTS.NOTION_DATA_SOURCE_ID,
    STATUS_PROPERTY_ID: props.getProperty('STATUS_PROPERTY_ID') || DEFAULTS.STATUS_PROPERTY_ID,
    WEBHOOK_KEY: props.getProperty('WEBHOOK_KEY') || Utilities.getUuid() + Utilities.getUuid(),
  };
  props.setProperties(values, false);
  ensureWebhookLogSheet_();
  Logger.log('Standalone setup complete. Run showSetupInfo() next.');
}
