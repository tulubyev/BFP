/**
 * GFW region codes (globalForestWatch.ts) → ISO. Only these 14 regions have a regional tree cover
 * loss estimate without GFW_API_KEY (national total × Rosleshozinforg share).
 */
export const GFW_CODE_TO_ISO: Record<string, string> = {
  irkutsk: 'RU-IRK', buryatia: 'RU-BU', zabaikalye: 'RU-ZAB', krasnoyarsk: 'RU-KYA', yakutia: 'RU-SA',
  khabarovsk: 'RU-KHA', primorye: 'RU-PRI', amur: 'RU-AMU', tomsk: 'RU-TOM', tyumen: 'RU-TYU',
  komi: 'RU-KO', arkhangelsk: 'RU-ARK', vologda: 'RU-VLG', karelia: 'RU-KR',
};
