export interface Region {
  id: number;
  code: string;
  name: string;
}

/** 初始化必寫的地區（03 §平台與地區）。TW 的資料 IGDB 沒有，由管理介面人工補登。 */
export const SEED_REGIONS: ReadonlyArray<Omit<Region, "id">> = [
  { code: "WW", name: "Worldwide" },
  { code: "US", name: "North America" },
  { code: "EU", name: "Europe" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "Korea" },
  { code: "CN", name: "China" },
  { code: "AU", name: "Australia" },
  { code: "ASIA", name: "Asia" },
  { code: "BR", name: "Brazil" },
  { code: "TW", name: "Taiwan" },
];
