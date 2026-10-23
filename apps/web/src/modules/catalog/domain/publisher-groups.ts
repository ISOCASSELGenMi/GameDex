/**
 * 全遊戲列表「依廠商分欄」的廠商對照表（唯一實作，原則五）。名單與歸屬規則：docs/design/publisher-groups.md（使用者 2026-10-18 定案）。
 *
 * - 每欄一個 key、三語名稱、IGDB 公司 id 清單（含子公司、工作室、更名前的公司；成員的名稱只是註記，比對一律用 igdbId）。
 *   IGDB 的母公司欄位（parent）沒有同步進資料庫，也只當輔助：最終以這張表為準。
 * - 歸屬規則：開發商優先 → 開發商都不在名單才看發行商 → 都不在歸「獨立／其他」。
 *   一款遊戲的多個開發商都在名單內時，取 IGDB 列出的第一個（`order` 最小者）；
 *   目前 game_companies 沒存 IGDB 的順序，所以呼叫端沒給 `order` 時改用「本表欄位順序最後者」（名單前段是大型集團，後段是獨立品牌，
 *   合開的作品歸更具體的品牌：尼爾：自動人形的開發商同時有史克威爾艾尼克斯與白金工作室 → 白金工作室；血源詛咒 → FromSoftware）——
 *   SQL 版（repository/release-columns.ts 用 {@link publisherGroupSqlMap} 產生）一律用這個替代規則，兩邊對沒有 order 的資料結果相同。
 * - 一個公司只能屬於一欄（單元測試檢查）。porting／supporting 角色不參與歸屬。
 * - 「Take-Two Interactive」本體（母公司、2K 品牌之前的發行者）歸 2K 欄；Rockstar 與 2K 以外的 Take-Two 品牌（Zynga 等）不列。
 */

/** 介面語系（zh-Hant、en、ja）；不 import @sok/i18n，保持 domain 零依賴。 */
export type PublisherGroupLocale = "zh-Hant" | "en" | "ja";

export interface PublisherGroup {
  /** 網址與欄位識別（小寫、連字號）。 */
  readonly key: string;
  readonly names: Readonly<Record<PublisherGroupLocale, string>>;
  /** [IGDB 公司 id, IGDB 上的公司名稱（註記用）]。 */
  readonly members: ReadonlyArray<readonly [igdbId: number, name: string]>;
}

/** 欄位順序＝docs/design/publisher-groups.md 的名單順序（也是歸屬的平手順序）。 */
export const PUBLISHER_GROUPS = [
  {
    key: "sony",
    names: { "zh-Hant": "索尼互動娛樂", en: "Sony Interactive Entertainment", ja: "ソニー・インタラクティブエンタテインメント" },
    members: [
      [10282, "Sony"], [243, "Sony Online Entertainment"], [620, "Bungie"], [25727, "Bungie West"],
      [10019, "Bend Studio"], [1030, "Bluepoint Games"], [12961, "Firesprite Ltd"], [7261, "Guerrilla Cambridge"],
      [1843, "Guerrilla Games"], [47581, "Haven Studios"], [1006, "Housemarque"], [834, "Insomniac Games"],
      [27364, "Japan Studio"], [746, "Media Molecule"], [401, "Naughty Dog"], [38826, "Nixxes"], [291, "Nixxes Software"],
      [4083, "PlayStation C.A.M.P."], [10126, "PlayStation Mobile Inc."], [26294, "PlayStation Studios"],
      [884, "Polyphony Digital"], [4357, "Santa Monica Studio"], [11040, "Santa Monica Studio"], [4107, "SCE Australia"],
      [726, "SCE Bend Studio"], [749, "SCE Cambridge Studio"], [7854, "SCE Connected Content Group"],
      [57515, "SCE Games Studio"], [400, "SCE Japan Studio"], [1033, "SCE London Studio"], [42582, "SCE San Diego Studio"],
      [15512, "SCE Santa Monica Studio"], [14487, "SCE Studio Cambridge"], [3053, "SCE Studio Liverpool"],
      [2291, "SCE Worldwide Studios Europe"], [13634, "Sony Computer Entertainment"],
      [27081, "Sony Computer Entertainment America"], [334, "Sony Computer Entertainment Europe"],
      [29568, "Sony Computer Entertainment Japan"], [2292, "Sony Computer Entertainment Japan Asia"],
      [907, "Sony Computer Entertainment of America"], [10100, "Sony Interactive Entertainment"],
      [15088, "Sony Interactive Entertainment America"], [9606, "Sony Interactive Entertainment Europe"],
      [46537, "Sony Interactive Entertainment Inc."], [2289, "Sony Interactive Entertainment Worldwide Studios"],
      [22450, "Sony Interactive Entertainment Worldwide Studios America"], [4617, "Sony Interactive Studios America"],
      [11687, "Sony XDev"], [403, "Sucker Punch Productions"], [54936, "Team Asobi"],
    ],
  },
  {
    key: "nintendo",
    names: { "zh-Hant": "任天堂", en: "Nintendo", ja: "任天堂" },
    members: [
      [25077, "Intelligent Systems"],
      [2910, "1-UP Studio"], [762, "HAL Laboratory"], [17908, "HAL Labs"], [1119, "Monolith Soft"],
      [1054, "Next Level Games"], [70, "Nintendo"], [652, "Nintendo Australia"], [66007, "Nintendo Cube"],
      [1103, "Nintendo EAD Software Development Group No.1"], [1246, "Nintendo EAD Software Development Group No.2"],
      [1366, "Nintendo EAD Software Development Group No.3"], [1048, "Nintendo EAD Software Development Group No.4"],
      [2342, "Nintendo EAD Software Development Group No.5"], [773, "Nintendo EAD Tokyo Software Development Group No.1"],
      [45192, "Nintendo EAD Tokyo Software Development Group No.2"], [421, "Nintendo Entertainment Analysis & Development"],
      [7902, "Nintendo Entertainment Planning & Development"], [73545, "Nintendo EPD Co-Production Group"],
      [45215, "Nintendo EPD Production Group No. 10"], [45209, "Nintendo EPD Production Group No. 3"],
      [45210, "Nintendo EPD Production Group No. 4"], [45211, "Nintendo EPD Production Group No. 5"],
      [65520, "Nintendo EPD Production Group No. 6"], [45212, "Nintendo EPD Production Group No. 7"],
      [45213, "Nintendo EPD Production Group No. 8"], [45214, "Nintendo EPD Production Group No. 9"],
      [26044, "Nintendo European Research & Development"], [46552, "Nintendo European Research and Development"],
      [43272, "Nintendo Game Seminar"], [5953, "Nintendo IRD"], [2850, "Nintendo of America"], [4034, "Nintendo of Europe"],
      [19598, "Nintendo of Korea"], [1809, "Nintendo R&D1"], [1774, "Nintendo R&D2"], [13332, "Nintendo R&D3"],
      [32471, "Nintendo R&D4"], [768, "Nintendo Software Technology"], [2935, "Nintendo SPD"],
      [2674, "Nintendo SPD Production Group No. 1"], [866, "Nintendo SPD Production Group No. 2"],
      [2167, "Nintendo SPD Production Group No. 3"], [1977, "Nintendo SPD Production Group No. 4"],
      [1276, "Nintendo SPD Software Development Group"], [766, "Retro Studios"],
    ],
  },
  {
    key: "xbox",
    names: { "zh-Hant": "Xbox Game Studios（微軟）", en: "Xbox Game Studios", ja: "Xbox Game Studios" },
    members: [
      [17213, "Xbox Live Arcade"], [808, "Xbox Live Production"],
      [722, "343 Industries"], [1924, "Compulsion Games"], [85, "Double Fine Productions"], [68, "Ensemble Studios"],
      [58892, "Halo Studios"], [393, "inXile Entertainment"], [6, "Lionhead Studios"], [128, "Microsoft"],
      [21784, "Microsoft Casual Games"], [17047, "Microsoft Corporation"], [53, "Microsoft Game Studios"],
      [81488, "Microsoft Game Studios Japan"], [6383, "Microsoft Home"], [1010, "Microsoft Studios"],
      [58, "Mojang Studios"], [795, "Ninja Theory"], [47, "Obsidian Entertainment"], [1432, "Playground Games"],
      [771, "Rare"], [30766, "Rare Limited"], [5961, "The Coalition"], [30445, "The Initiative"], [1022, "Turn 10 Studios"],
      [1433, "Undead Labs"], [22619, "World's Edge"], [17966, "Xbox Game Studios"],
    ],
  },
  {
    key: "bethesda",
    names: { "zh-Hant": "貝塞斯達（微軟）", en: "Bethesda", ja: "ベセスダ" },
    members: [
      [35055, "Arkane Austin"], [19, "Arkane Studios"], [18809, "Arkane Studios SA"], [126, "Bethesda Game Studios"],
      [16565, "Bethesda Softworks"], [184, "id Software"], [1242, "MachineGames"], [31693, "RoundHouse Entertainment"],
      [47087, "Roundhouse Studios"], [2145, "Tango Gameworks"], [3130, "Zenimax Europe"], [3894, "ZeniMax Germany"],
      [245, "ZeniMax Media"], [37094, "ZeniMax Media Inc."], [851, "ZeniMax Online Studios"],
    ],
  },
  {
    key: "activision-blizzard",
    names: { "zh-Hant": "動視暴雪（微軟）", en: "Activision Blizzard", ja: "アクティビジョン・ブリザード" },
    members: [
      [66, "Activision"], [34439, "Activision Asia-Pacific"], [179, "Activision Blizzard"],
      [34438, "Activision Deutchland"], [34440, "Activision Italia"], [3582, "Activision Publishing"],
      [1643, "Activision Publishing Minneapolis Inc."], [14333, "Activision Shanghai"], [6559, "Activision UK"],
      [1488, "Activision Value"], [32530, "Activision Value Publishing"], [432, "Beenox"], [121, "Blizzard Classic Arcade"],
      [51, "Blizzard Entertainment"], [59, "Blizzard North"], [3581, "Demonware"], [434, "High Moon Studios"],
      [438, "Infinity Ward"], [1285, "King"], [65, "Luxoflux"], [90, "Neversoft Entertainment"], [71, "Raven Software"],
      [659, "Sledgehammer Games"], [741, "Toys for Bob"], [428, "Treyarch"], [72, "Vicarious Visions"],
    ],
  },
  {
    key: "rockstar",
    names: { "zh-Hant": "Rockstar Games（Take-Two）", en: "Rockstar Games", ja: "Rockstar Games" },
    members: [
      [29, "Rockstar Games"], [308, "Rockstar Leeds"], [638, "Rockstar London"], [637, "Rockstar New England"],
      [365, "Rockstar North"], [364, "Rockstar San Diego"], [306, "Rockstar Toronto"], [636, "Rockstar Vancouver"],
      [307, "Rockstar Vienna"],
    ],
  },
  {
    key: "2k",
    names: { "zh-Hant": "2K（Take-Two）", en: "2K", ja: "2K" },
    members: [
      [20228, "2K"], [2492, "2K Australia"], [649, "2K Boston"], [18, "2K China"], [301, "2K Czech"], [8, "2K Games"],
      [15, "2K Marin"], [2001, "2K Play"], [1975, "2K Sports"], [2000, "Cat Daddy Games"], [22832, "Cloud Chamber"],
      [377, "Firaxis Games"], [11262, "Gearbox Publishing"], [148, "Gearbox Software"], [6079, "Hangar 13"],
      [1992, "Kush Games"], [14035, "Private Division"], [139, "Take-Two Interactive"], [694, "Visual Concepts"],
      [33969, "Visual Concepts, Ltd."],
    ],
  },
  {
    key: "capcom",
    names: { "zh-Hant": "卡普空", en: "Capcom", ja: "カプコン" },
    members: [
      [37, "Capcom"], [42265, "Capcom Development Division 1"], [42454, "Capcom Development Division 2"],
      [11901, "Capcom Entertainment, Inc."], [3394, "Capcom Europe"], [1611, "Capcom Game Studio Vancouver, Inc."],
      [3630, "Capcom Japan"], [2347, "Capcom Osaka"], [42627, "Capcom Planning Room 2"],
      [660, "Capcom Production Studio 1"], [892, "Capcom Production Studio 2"], [655, "Capcom Production Studio 3"],
      [663, "Capcom Production Studio 4"], [1360, "Capcom Production Studio 6"], [2559, "Capcom Production Studio 8"],
      [3393, "Capcom USA"], [27528, "Capcom Vancouver"],
    ],
  },
  {
    key: "koei-tecmo",
    names: { "zh-Hant": "光榮特庫摩", en: "Koei Tecmo", ja: "コーエーテクモ" },
    members: [
      [3046, "Gust"], [630, "Koei"], [2967, "Koei Canada"], [77187, "KOEI Co., Ltd."], [77188, "KOEI Corporation"],
      [18532, "Koei Tecmo"], [6066, "Koei Tecmo America Corporation"], [7445, "Koei Tecmo Europe"],
      [858, "Koei Tecmo Games"], [38951, "Koei Tecmo Games Co."], [8482, "Koei Tecmo Holdings"],
      [14653, "KOEI TECMO SINGAPORE, Pte, Ltd."], [13087, "Koei Tecmo Wave"], [1394, "Omega Force"], [769, "Team NINJA"],
      [14776, "Tecmo"], [2020, "Tecmo Co., Ltd."], [24352, "Tecmo Koei Games"],
    ],
  },
  {
    key: "bandai-namco",
    names: { "zh-Hant": "萬代南夢宮", en: "Bandai Namco", ja: "バンダイナムコ" },
    members: [
      [617, "Bandai"], [1725, "Bandai America"], [25803, "Bandai Digital Entertainment"], [42147, "Bandai Namco Aces Inc."],
      [8381, "Bandai Namco Amusement"], [60590, "Bandai Namco Amusement America"], [48869, "Bandai Namco Amusement Europe"],
      [248, "Bandai Namco Entertainment"], [9608, "Bandai Namco Entertainment America"],
      [29936, "Bandai Namco Entertainment America Inc."], [9666, "Bandai Namco Entertainment Asia"],
      [9607, "Bandai Namco Entertainment Europe"], [29941, "Bandai Namco Entertainment Europe S.A.S"],
      [62122, "Bandai Namco Forge Digitals"], [3958, "Bandai Namco Games"], [29716, "BANDAI NAMCO Games Asia Pte Ltd"],
      [31177, "Bandai Namco Games Daewon Media (South Korea)"], [29715, "BANDAI NAMCO Games Europe S.A.S"],
      [29706, "BANDAI NAMCO Games Inc"], [5024, "Bandai Namco Holdings"], [19323, "Bandai Namco Online"],
      [22721, "Bandai Namco Studios"], [16583, "Bandai Namco Studios Malaysia"], [16586, "Bandai Namco Studios Singapore"],
      [22474, "Bandai Visual"], [263, "Namco"], [2995, "Namco Bandai America"], [3247, "Namco Bandai Europe"],
      [6330, "Namco Bandai Games"], [21719, "Namco Bandai Games America"], [11373, "NAMCO BANDAI Games America Inc."],
      [3253, "Namco Bandai Games Asia"], [11359, "Namco Bandai Games Europe S.A.S."], [25663, "NAMCO BANDAI Games Inc."],
      [78191, "Namco Bandai Networks Europe"], [78190, "Namco Bandai Networks Romania"], [755, "Namco Bandai Partners"],
      [13815, "Namco Bandai Studios Inc."], [46257, "Namco Corporation"], [10070, "Namco Hometek"],
      [13956, "Namco Limited"], [44318, "Namco Mobile"], [2256, "Namco Network"], [7517, "Namco Networks America, Inc."],
      [826, "Namco Tales Studio"], [10178, "Namcot"],
    ],
  },
  {
    key: "square-enix",
    names: { "zh-Hant": "史克威爾艾尼克斯", en: "Square Enix", ja: "スクウェア・エニックス" },
    members: [
      [817, "Taito"], [77072, "Taito America Corporation"], [1440, "Taito Corporation"], [31702, "Taito GM R&D Sect. #2"],
      [26323, "Enix"], [2783, "Enix America Corporation"], [250, "Square"], [252, "Square Electronic Arts"],
      [26, "Square Enix"], [93, "Square Enix 1st Production Department"], [52915, "Square Enix Business Division 1"],
      [13472, "Square Enix Business Division 10"], [53134, "Square Enix Business Division 11"],
      [23018, "Square Enix Business Division 2"], [19281, "Square Enix Business Division 3"],
      [52934, "Square Enix Business Division 4"], [52267, "Square Enix Business Division 5"],
      [53031, "Square Enix Business Division 6"], [53499, "Square Enix Business Division 7"],
      [52931, "Square Enix Business Division 8"], [53042, "Square Enix Business Division 9"],
      [9385, "Square Enix Collective"], [45304, "Square Enix Creative Business Unit I"],
      [52310, "Square Enix Creative Business Unit II"], [38128, "Square Enix Creative Business Unit III"],
      [52311, "Square Enix Creative Business Unit IV"], [72234, "Square Enix Creative Studio 1"],
      [72232, "Square Enix Creative Studio 2"], [54647, "Square Enix Creative Studio 3"],
      [72233, "Square Enix Creative Studio 4"], [66148, "Square Enix Creative Studio 5"],
      [73592, "Square Enix Creative Studio 7"], [4940, "Square Enix Europe"],
      [36290, "Square Enix First Development Division"], [35555, "Square Enix Limited"],
      [824, "Square Enix London Studios"], [12473, "Square Enix Montréal"],
      [799, "Square Enix Product Development Division 1"], [53032, "Square Enix Product Development Division 10"],
      [10938, "Square Enix Product Development Division 2"], [336, "Square Enix Product Development Division 3"],
      [337, "Square Enix Product Development Division 4"], [801, "Square Enix Product Development Division 5"],
      [26389, "Square Enix Product Development Division 6"], [53015, "Square Enix Product Development Division 7"],
      [2862, "Square Enix Product Development Division 8"], [53029, "Square Enix Product Development Division 9"],
      [253, "Square Europe"], [53150, "Square Osaka Development Department"],
      [52975, "Square Product Development Division 1"], [1112, "Square Product Development Division 2"],
      [335, "Square Product Development Division 3"], [5544, "Square Product Development Division 4"],
      [53010, "Square Product Development Division 5"], [4452, "Square Product Development Division 6"],
      [3061, "Square USA"], [53108, "SquareSoft USA"],
    ],
  },
  {
    key: "epic",
    names: { "zh-Hant": "Epic Games", en: "Epic Games", ja: "Epic Games" },
    members: [
      [17463, "Epic Games"], [6664, "Epic Games China"], [37382, "Epic Games Publishing"], [206, "Epic MegaGames"],
      [2581, "Mediatonic"], [711, "Psyonix"],
    ],
  },
  {
    key: "ubisoft",
    names: { "zh-Hant": "育碧", en: "Ubisoft", ja: "ユービーアイソフト" },
    members: [
      [7923, "Blue Byte"], [646, "Blue Byte Software"], [21412, "Blue Byte Software GmbH"], [537, "Massive Entertainment"],
      [717, "Red Storm Entertainment"], [16845, "Ubi Soft Entertainment"], [77135, "Ubi Soft Paris Studios"],
      [23299, "Ubi Soft Studios SRL"], [17158, "Ubi Studios UK"], [60706, "Ubisoft Abu Dhabi"], [39, "Ubisoft Annecy"],
      [798, "Ubisoft Australia"], [1990, "Ubisoft Barcelona"], [15463, "Ubisoft Belgrade"], [1897, "Ubisoft Berlin"],
      [19099, "Ubisoft Blue Byte"], [17064, "Ubisoft Bordeaux"], [697, "Ubisoft Bucharest"], [898, "Ubisoft Casablanca"],
      [3928, "Ubisoft Chengdu"], [11980, "Ubisoft China"], [60832, "Ubisoft Craiova"], [68755, "Ubisoft Da Nang"],
      [35788, "Ubisoft Düsseldorf"], [104, "Ubisoft Entertainment"], [5769, "Ubisoft Europe"], [4369, "Ubisoft Japan"],
      [2921, "Ubisoft Kyiv"], [17486, "Ubisoft Leamington"], [41465, "Ubisoft Mainz"], [899, "Ubisoft Milan"],
      [35649, "Ubisoft Mobile Games"], [702, "Ubisoft Montpellier"], [38, "Ubisoft Montreal"], [30122, "Ubisoft Mumbai"],
      [26178, "Ubisoft Nadeo"], [33498, "Ubisoft Nagoya"], [14693, "Ubisoft Newcastle"], [3262, "Ubisoft North America"],
      [38920, "Ubisoft Odesa"], [8264, "Ubisoft Osaka"], [20513, "Ubisoft Owlient"], [841, "Ubisoft Paris"],
      [24833, "Ubisoft Paris Mobile"], [15260, "Ubisoft Philippines"], [3655, "Ubisoft Pune"], [15790, "Ubisoft Québec"],
      [897, "Ubisoft Red Storm"], [433, "Ubisoft Reflections"], [46350, "Ubisoft Romania"], [38989, "Ubisoft Saguenay"],
      [1225, "Ubisoft San Francisco"], [2232, "Ubisoft Sao Paulo"], [398, "Ubisoft Shanghai"], [822, "Ubisoft Singapore"],
      [840, "Ubisoft Sofia"], [56495, "Ubisoft Stockholm"], [847, "Ubisoft Toronto"], [60833, "Ubisoft Ukraine"],
      [35554, "Ubisoft US"], [2082, "Ubisoft Vancouver"], [38990, "Ubisoft Winnipeg"],
    ],
  },
  {
    key: "ea",
    names: { "zh-Hant": "美商藝電", en: "Electronic Arts", ja: "エレクトロニック・アーツ" },
    members: [
      [115, "Codemasters"], [2340, "Codemasters Birmingham"], [29365, "Codemasters Cheshire"], [2945, "Codemasters Guildford"], [9018, "Codemasters Racing Studio"], [412, "Codemasters Southam"],
      [2, "BioWare"], [3845, "BioWare Austin"], [38946, "BioWare Corporation"], [222, "BioWare Edmonton"],
      [3903, "BioWare Montréal"], [12747, "BioWare Mythic"], [347, "Criterion Games"], [10151, "DICE Los Angeles"],
      [63288, "DICE New York"], [576, "Digital Illusions"], [137, "Digital Illusions CE"],
      [153, "Digital Illusions CE: Canada"], [332, "EA Black Box"], [2142, "EA Bright Light"], [277, "EA Canada"],
      [94, "EA Digital Illusions CE"], [19200, "EA Games"], [140, "EA Los Angeles"], [1505, "EA Maxis"],
      [351, "EA Montreal"], [555, "EA Orlando"], [9455, "EA Phenomic"], [11, "EA Redwood Shores"], [4148, "EA Romania"],
      [1258, "EA Salt Lake"], [350, "EA Seattle"], [454, "EA Sports"], [1945, "EA Sports BIG"],
      [79444, "EA Sports Freestyle"], [63840, "EA Tiburon"], [27222, "EA Vancouver"], [1, "Electronic Arts"],
      [64578, "Electronic Arts Distribution"], [39467, "Electronic Arts Soul"], [14546, "Electronic Arts UK"],
      [200, "Electronic Arts Victor"], [28050, "Electronic Arts, Inc."], [284, "Maxis"], [22170, "Maxis Software"],
      [13794, "Maxis South"], [12478, "Motive Studios"], [1002, "Respawn Entertainment"], [7, "Visceral Games"],
      [13729, "Visceral Melbourne"], [13728, "Visceral Montreal"],
    ],
  },
  {
    key: "sega",
    names: { "zh-Hant": "SEGA", en: "SEGA", ja: "セガ" },
    members: [
      [24792, "CREATIVE ASSEMBLY"], [27872, "Creative Assembly Sofia"], [4484, "Hardlight"],
      [19080, "Ryu Ga Gotoku Studio"], [112, "Sega"], [68455, "Sega 2nd Development Division"], [36676, "Sega AM Annex"],
      [36659, "Sega AM Port Team"], [6002, "SEGA AM1"], [40133, "Sega AM11"], [830, "Sega AM2"], [2327, "Sega AM3"],
      [12822, "SEGA AM4"], [4455, "Sega AM5"], [6003, "SEGA AM7"], [870, "SEGA Amusements Europe"],
      [53038, "Sega Amusements International"], [14087, "Sega Corporation"], [16367, "Sega CS1"], [22924, "Sega CS2 R&D"],
      [27937, "Sega CS3"], [77199, "SEGA CS5 R&D"], [2753, "Sega Development Division #3"], [37917, "Sega Electronics"],
      [50699, "Sega Enterprises, Inc."], [11739, "Sega Enterprises, Inc. (USA)"], [4981, "Sega Enterprises, Ltd."],
      [10141, "Sega Entertainment"], [1666, "Sega Europe"], [35654, "Sega Europe Ltd."], [60827, "SEGA FAVE"],
      [15878, "Sega Games"], [25544, "SEGA HARDlight"], [50701, "Sega Interactive"],
      [10187, "SEGA Interactive Development Division"], [68469, "Sega Interactive R&D3"], [4003, "Sega International"],
      [10097, "Sega Midwest Development Division"], [25542, "Sega Mobile"], [23996, "Sega Multimedia Studio"],
      [61485, "Sega Music Networks"], [229, "Sega of America"], [35643, "SEGA of America, Inc."], [4468, "SEGA of Japan"],
      [36658, "Sega PC"], [56608, "Sega Personal Computer Division"], [24000, "Sega R&D 2"], [68450, "Sega R&D1"],
      [68460, "Sega R&D4"], [869, "SEGA Racing Studio"], [2892, "Sega Rosso"], [2211, "Sega Sammy Holdings"],
      [53041, "Sega Shanghai Studio"], [40134, "Sega Software R&D Dept. 1"], [37850, "Sega Software R&D Dept. 3"],
      [40132, "Sega Software R&D Dept. 4"], [1272, "Sega Sports R&D"], [2021, "Sega Studio USA"], [32589, "Sega Studios"],
      [2984, "Sega Studios Australia"], [2208, "Sega Studios San Francisco"], [1444, "Sega Technical Institute"],
      [7052, "Sega WOW"], [37698, "Sega, S.A. SONIC"], [9528, "Sega/Gremlin"], [568, "SegaSoft"], [395, "Sonic Team"],
      [15184, "Sonic Team Junior"], [25543, "Sonic Team USA"], [486, "Sports Interactive"], [111, "The Creative Assembly"],
      [14440, "Two Point Studios"],
    ],
  },
  {
    key: "atlus",
    names: { "zh-Hant": "Atlus（SEGA）", en: "Atlus", ja: "アトラス" },
    members: [
      [818, "Atlus"], [31284, "Atlus Co., Ltd"], [2488, "Atlus USA"], [11839, "Studio Zero"],
    ],
  },
  {
    key: "konami",
    names: { "zh-Hant": "科樂美", en: "Konami", ja: "コナミ" },
    members: [
      [129, "Konami"], [22806, "Konami Amusement"], [70325, "Konami Arcade Games"],
      [42167, "Konami Computer Entertainment Chicago"], [2817, "Konami Computer Entertainment Hawaii"],
      [312, "Konami Computer Entertainment Japan"], [777, "Konami Computer Entertainment Kobe"],
      [1822, "Konami Computer Entertainment Nagoya"], [5292, "Konami Computer Entertainment Osaka"],
      [39132, "Konami Computer Entertainment Sapporo"], [25057, "Konami Computer Entertainment Shinjuku"],
      [43870, "Konami Computer Entertainment Studios"], [159, "Konami Computer Entertainment Tokyo"],
      [37122, "Konami Computer Entertainment Tokyo, Inc."], [69280, "Konami Computer Games Aoyama"],
      [22785, "Konami Corporation"], [161, "Konami Digital Entertainment"], [2878, "Konami Industry"],
    ],
  },
  {
    key: "tencent",
    names: { "zh-Hant": "騰訊遊戲（騰訊）", en: "Tencent Games", ja: "テンセントゲームズ" },
    members: [
      [39493, "Level Infinite"], [42215, "Lightspeed Games"], [51434, "Lightspeed LA"], [41477, "LightSpeed Studios"],
      [17032, "Tencent Aurora Studios"], [3595, "Tencent Games"], [42, "Tencent Holdings"], [16119, "Timi"],
      [35809, "TiMi Studio Group"],
    ],
  },
  {
    key: "riot",
    names: { "zh-Hant": "拳頭遊戲（騰訊）", en: "Riot Games", ja: "ライアットゲームズ" },
    members: [
      [22901, "Riot Forge"], [41, "Riot Games"],
    ],
  },
  {
    key: "valve",
    names: { "zh-Hant": "Valve", en: "Valve", ja: "Valve" },
    members: [
      [56, "Valve"],
    ],
  },
  {
    key: "mihoyo",
    names: { "zh-Hant": "米哈遊", en: "miHoYo (HoYoverse)", ja: "miHoYo（HoYoverse）" },
    members: [
      [40242, "Cognosphere"], [41907, "HoYoverse"], [15932, "miHoYo"],
    ],
  },
  {
    key: "warner",
    names: { "zh-Hant": "華納兄弟遊戲", en: "Warner Bros. Games", ja: "ワーナー・ブラザース・ゲームズ" },
    members: [
      [1309, "Avalanche Software"], [407, "Monolith Productions"], [48, "NetherRealm Studios"],
      [39213, "Player First Games"], [164, "Rocksteady Studios"], [1290, "TT Fusion"], [293, "TT Games"],
      [1637, "TT Games Publishing"], [470, "Turbine"], [20400, "Warner Bros. Entertainment Inc."],
      [30651, "Warner Bros. Games"], [14055, "Warner Bros. Interactive Entertainment"], [1633, "Warner Bros. Studios"],
      [45784, "Warner Interactive Entertainment"], [37084, "WarnerActive"], [50, "WB Games"], [937, "WB Games Montréal"],
      [4448, "WB Games New York"],
    ],
  },
  {
    key: "netease",
    names: { "zh-Hant": "網易遊戲", en: "NetEase Games", ja: "NetEase Games" },
    members: [
      [32410, "NetEase"], [5501, "NetEase Games"], [41794, "NetEase Games Montréal"],
    ],
  },
  {
    key: "cdpr",
    names: { "zh-Hant": "CD PROJEKT RED", en: "CD PROJEKT RED", ja: "CD PROJEKT RED" },
    members: [
      [4291, "CD Projekt"], [908, "CD Projekt RED"], [19166, "CD Projekt Red Wrocław"], [29958, "CD Projekt S.A."],
    ],
  },
  {
    key: "fromsoftware",
    names: { "zh-Hant": "FromSoftware（角川）", en: "FromSoftware", ja: "フロム・ソフトウェア" },
    members: [
      [1012, "FromSoftware"],
    ],
  },
  {
    key: "spike-chunsoft",
    names: { "zh-Hant": "Spike Chunsoft（角川）", en: "Spike Chunsoft", ja: "スパイク・チュンソフト" },
    members: [
      [1093, "Chunsoft"], [1053, "Spike"], [1217, "Spike Chunsoft"], [38017, "Spike Chunsoft Co., Ltd."],
      [5172, "Spike Chunsoft, Inc."], [22748, "Spike Co. Ltd"],
    ],
  },
  {
    key: "kuro",
    names: { "zh-Hant": "庫洛遊戲", en: "Kuro Games", ja: "Kuro Games" },
    members: [
      [36031, "Kuro Games"],
    ],
  },
  {
    key: "hypergryph",
    names: { "zh-Hant": "鷹角網路", en: "Hypergryph", ja: "Hypergryph" },
    members: [
      [53191, "Gryphline"], [35901, "Hypergryph"],
    ],
  },
  {
    key: "arc-system-works",
    names: { "zh-Hant": "亞克系統", en: "Arc System Works", ja: "アークシステムワークス" },
    members: [
      [1218, "Arc System Works"], [16956, "Arc System Works America"],
    ],
  },
  {
    key: "cygames",
    names: { "zh-Hant": "Cygames", en: "Cygames", ja: "Cygames" },
    members: [
      [6181, "Cygames"], [39195, "Cygames Osaka"],
    ],
  },
  {
    key: "kojima",
    names: { "zh-Hant": "小島製作", en: "Kojima Productions", ja: "コジマプロダクション" },
    members: [
      [170, "Kojima Productions"], [6601, "Kojima Productions LA Studio"],
    ],
  },
  {
    key: "falcom",
    names: { "zh-Hant": "Falcom", en: "Nihon Falcom", ja: "日本ファルコム" },
    members: [
      [2400, "Falcom"], [2751, "Nihon Falcom"],
    ],
  },
  {
    key: "platinum",
    names: { "zh-Hant": "白金工作室", en: "PlatinumGames", ja: "プラチナゲームズ" },
    members: [
      [852, "PlatinumGames"], [15793, "PlatinumGames TOKYO"],
    ],
  },
  {
    key: "snk",
    names: { "zh-Hant": "SNK", en: "SNK", ja: "SNK" },
    members: [
      [1474, "SNK"], [16923, "SNK Corporation"], [3157, "SNK Games"], [30192, "SNK Home Entertainment, Inc."],
      [2299, "SNK Neogeo USA Consumer"], [10098, "SNK of America"], [2582, "SNK Playmore"],
      [77614, "SNK Playmore Corporation"], [10099, "SNK Playmore USA"],
    ],
  },
  {
    key: "type-moon",
    names: { "zh-Hant": "型月", en: "TYPE-MOON", ja: "TYPE-MOON" },
    members: [
      [6429, "TYPE-MOON"], [56918, "TYPE-MOON studio BB"],
    ],
  },
  {
    key: "nexon",
    names: { "zh-Hant": "Nexon", en: "Nexon", ja: "ネクソン" },
    members: [
      [7716, "Neople"], [8431, "Nexon"], [17597, "Nexon America"], [1414, "Nexon Co. Ltd."], [40528, "Nexon Games"],
      [18714, "Nexon GT"], [17940, "Nexon Korea"], [19119, "Nexon Korea Corporation"], [42234, "Nexon Thailand"],
    ],
  },
  {
    key: "paradox",
    names: { "zh-Hant": "Paradox Interactive", en: "Paradox Interactive", ja: "Paradox Interactive" },
    members: [
      [43813, "Paradox Arc"], [940, "Paradox Arctic"], [7466, "Paradox Development Studio"],
      [10993, "Paradox Entertainment"], [517, "Paradox Interactive"], [46095, "Paradox Tectonic"], [54212, "Paradox Tinto"],
    ],
  },
] as const satisfies readonly PublisherGroup[];

export type PublisherGroupKey = (typeof PUBLISHER_GROUPS)[number]["key"];

/** 名單以外的公司歸這一欄（永遠排在最後）。 */
export const OTHER_PUBLISHER_KEY = "other" as const;
export type PublisherColumnKey = PublisherGroupKey | typeof OTHER_PUBLISHER_KEY;

export const OTHER_PUBLISHER_NAMES: Readonly<Record<PublisherGroupLocale, string>> = {
  "zh-Hant": "獨立／其他",
  en: "Indie & Other",
  ja: "インディー・その他",
};

/** 全部欄位的 key（名單順序，最後是 other）。 */
export const PUBLISHER_COLUMN_KEYS: readonly PublisherColumnKey[] = [...PUBLISHER_GROUPS.map((g) => g.key), OTHER_PUBLISHER_KEY];

export function isPublisherColumnKey(value: string): value is PublisherColumnKey {
  return (PUBLISHER_COLUMN_KEYS as readonly string[]).includes(value);
}

/** 欄位的顯示名稱；不在清單的語系退回英文。 */
export function publisherColumnName(key: PublisherColumnKey, locale: string): string {
  const names: Readonly<Record<PublisherGroupLocale, string>> =
    key === OTHER_PUBLISHER_KEY ? OTHER_PUBLISHER_NAMES : PUBLISHER_GROUPS.find((g) => g.key === key)!.names;
  return names[locale as PublisherGroupLocale] ?? names.en;
}

/** IGDB 公司 id → 欄位索引（PUBLISHER_GROUPS 的位置）。 */
const GROUP_INDEX_BY_IGDB_ID: ReadonlyMap<number, number> = new Map(
  PUBLISHER_GROUPS.flatMap((g, i) => g.members.map(([igdbId]) => [igdbId, i] as const)),
);

/** 公司所屬的欄位 key；不在名單回 null。 */
export function publisherGroupOfCompany(igdbId: number): PublisherGroupKey | null {
  const i = GROUP_INDEX_BY_IGDB_ID.get(igdbId);
  return i === undefined ? null : PUBLISHER_GROUPS[i]!.key;
}

export interface GameCompanyRef {
  /** companies.igdb_id */
  igdbId: number;
  /** game_companies.role（developer、publisher、porting、supporting） */
  role: string;
  /** IGDB 列出的順序（0 起算，小的在前）；目前資料庫沒存，沒有時用欄位順序平手。 */
  order?: number;
}

function pickGroup(refs: readonly GameCompanyRef[], role: "developer" | "publisher"): number | null {
  let best: { order: number; group: number } | null = null;
  for (const r of refs) {
    if (r.role !== role) continue;
    const group = GROUP_INDEX_BY_IGDB_ID.get(r.igdbId);
    if (group === undefined) continue;
    const order = r.order ?? Number.POSITIVE_INFINITY;
    if (!best || order < best.order || (order === best.order && group > best.group)) best = { order, group };
  }
  return best ? best.group : null;
}

/**
 * 一款遊戲歸哪一欄（純函式）：開發商優先 → 發行商 → other。
 * 艾爾登法環（開發 FromSoftware、發行萬代南夢宮）→ fromsoftware。
 */
export function groupOfGame(companies: readonly GameCompanyRef[]): PublisherColumnKey {
  return publisherColumnKeyOfIndex(publisherGroupIndexOfGame(companies));
}

/**
 * 一款遊戲歸哪一欄，以欄位索引表示（PUBLISHER_GROUPS 的位置；{@link OTHER_PUBLISHER_INDEX}＝other）。
 * 同一份規則：寫入路徑（games.publisher_group，syncIgdbGame／回填）用這個，不另寫第二份。
 */
export function publisherGroupIndexOfGame(companies: readonly GameCompanyRef[]): number {
  return pickGroup(companies, "developer") ?? pickGroup(companies, "publisher") ?? OTHER_PUBLISHER_INDEX;
}

/** games.publisher_group 的 other（名單以外）。 */
export const OTHER_PUBLISHER_INDEX = -1;

/** 欄位索引（SQL 算出來的 group_idx；null 或負數＝other）→ key。 */
export function publisherColumnKeyOfIndex(index: number | null): PublisherColumnKey {
  return index === null || index < 0 || index >= PUBLISHER_GROUPS.length ? OTHER_PUBLISHER_KEY : PUBLISHER_GROUPS[index]!.key;
}

/**
 * 給 SQL 用的對照（兩個等長陣列：IGDB 公司 id、欄位索引）：`unnest(igdb_ids, group_idx)` 當成對照表 join companies.igdb_id。
 * SQL 的規則與 {@link groupOfGame} 相同（開發商優先、欄位順序平手）；id 清單只存在這個檔案。
 */
export function publisherGroupSqlMap(): { igdbIds: number[]; groupIdx: number[] } {
  const igdbIds: number[] = [];
  const groupIdx: number[] = [];
  for (const [igdbId, group] of GROUP_INDEX_BY_IGDB_ID) {
    igdbIds.push(igdbId);
    groupIdx.push(group);
  }
  return { igdbIds, groupIdx };
}
