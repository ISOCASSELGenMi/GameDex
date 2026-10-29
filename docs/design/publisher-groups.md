# 全遊戲列表「依廠商分欄」名單（使用者 2026-10-18 定案）

用於全遊戲列表頁的「廠商」分組。名單以外的公司一律歸「獨立／其他」。

## 歸屬規則

- **不能只看發行商**：開發商與發行商都要比對。一款遊戲的開發商或發行商（含其子公司、工作室）屬於某一欄，就歸入那一欄。
- **大公司旗下的知名品牌獨立成欄**：名稱後面括號標母公司（例如「FromSoftware（角川）」）。旗下品牌的遊戲歸該品牌欄，**不再**重複算進母公司欄；母公司欄只收不屬於任何獨立品牌的作品。
- 對應方式：以 IGDB 公司 id 建對照表（品牌 → IGDB 公司 id 清單，含子工作室與更名前的公司），放在 catalog 的 domain 常數，唯一實作；IGDB 的母公司欄位（`parent`）只當輔助，最終以對照表為準。
- 一款遊戲同時屬於多欄時**只放一欄，以開發商優先**（例如艾爾登法環：開發 FromSoftware、發行萬代南夢宮 → 歸 FromSoftware）；開發商不在名單內才看發行商；都不在名單內歸「獨立／其他」。多個開發商都在名單內時取 IGDB 列出的第一個（使用者 2026-10-18）。
- 有公認中文名的寫中文名；沒有的保留原文。

## 名單

使用者 2026-10-23 對照表疑義定案：上表「包含」欄補入 Sony／Sony Online Entertainment／Bungie → 索尼互動娛樂、Xbox Live Arcade／Production → Xbox、Codemasters → 美商藝電、Intelligent Systems → 任天堂、Taito → 史克威爾艾尼克斯。Crystal Dynamics、Eidos、Relic、Amplitude、Time Warner Interactive、Fire Falcom、Snkl Studio 不納入（獨立／其他）。

同角色多家公司都在名單內時取 IGDB 列出的第一個（game_companies.igdb_position，D88）；舊資料位置是 NULL 時的替代規則：取名單欄位順序最後者（合開作品歸更具體的品牌）。

| 欄位名稱 | 包含 | 代表作 |
|---|---|---|
| 索尼互動娛樂 | Sony Interactive Entertainment、Sony、Sony Online Entertainment、Bungie、PlayStation Studios 各工作室（Santa Monica、Naughty Dog、Insomniac、Guerrilla、Sucker Punch 等） | 戰神、最後生還者、漫威蜘蛛人、地平線 |
| 任天堂 | Nintendo、Nintendo EPD、HAL 研究所、Retro Studios、Monolith Soft、Intelligent Systems 等 | 薩爾達傳說、超級瑪利歐、集合啦！動物森友會、斯普拉遁 |
| Xbox Game Studios（微軟） | Microsoft、Xbox Live Arcade、Xbox Live Production、Xbox Game Studios（343、Playground、Rare、Obsidian、Double Fine 等） | 最後一戰、極限競速、盜賊之海 |
| 貝塞斯達（微軟） | Bethesda Softworks、Bethesda Game Studios、id Software、Arkane、MachineGames、ZeniMax | 上古卷軸、異塵餘生、毀滅戰士 |
| 動視暴雪（微軟） | Activision、Blizzard Entertainment、King、Treyarch、Infinity Ward 等 | 決勝時刻、暗黑破壞神、魔獸世界、鬥陣特攻 |
| Rockstar Games（Take-Two） | Rockstar 各工作室 | 俠盜獵車手 GTA、碧血狂殺 |
| 2K（Take-Two） | 2K、Firaxis、Visual Concepts、Gearbox 等 | NBA 2K、文明帝國、邊緣禁地 |
| 卡普空 | Capcom | 惡靈古堡、魔物獵人、快打旋風、逆轉裁判 |
| 光榮特庫摩 | Koei Tecmo、Omega Force、Team NINJA、Gust | 真・三國無雙、仁王、信長之野望、鍊金工房 |
| 萬代南夢宮 | Bandai Namco | 鐵拳、太鼓之達人、偶像大師、破曉傳奇 |
| 史克威爾艾尼克斯 | Square Enix、Taito | Final Fantasy、勇者鬥惡龍、王國之心、尼爾 |
| Epic Games | Epic Games | 要塞英雄、Rocket League、Fall Guys |
| 育碧 | Ubisoft 各工作室 | 刺客教條、極地戰嚎、湯姆克蘭西系列、舞力全開 |
| 美商藝電 | Electronic Arts、EA SPORTS、Respawn、BioWare、DICE、Maxis、Codemasters | EA SPORTS FC、Apex 英雄、模擬市民、戰地風雲 |
| SEGA | SEGA、Ryu Ga Gotoku Studio、Sonic Team、Creative Assembly | 人中之龍、音速小子、全軍破敵 |
| Atlus（SEGA） | Atlus | 女神異聞錄、真・女神轉生、暗喻幻想 |
| 科樂美 | Konami | 潛龍諜影、沉默之丘、eFootball、桃太郎電鐵 |
| 騰訊遊戲（騰訊） | Tencent、天美、光子 | 王者榮耀、和平精英 |
| 拳頭遊戲（騰訊） | Riot Games | 英雄聯盟、特戰英豪 |
| Valve | Valve | 半條命、絕對武力、Dota 2、傳送門 |
| 米哈遊 | miHoYo、HoYoverse | 原神、崩壞：星穹鐵道、絕區零 |
| 華納兄弟遊戲 | Warner Bros. Games、Avalanche（Portkey）、NetherRealm、Rocksteady | 霍格華茲的傳承、真人快打、蝙蝠俠：阿卡漢系列 |
| 網易遊戲 | NetEase Games | 第五人格、漫威爭鋒、永劫無間 |
| CD PROJEKT RED | CD PROJEKT | 巫師、電馭叛客 2077 |
| FromSoftware（角川） | FromSoftware | 黑暗靈魂、艾爾登法環、隻狼、機戰傭兵 |
| Spike Chunsoft（角川） | Spike Chunsoft | 槍彈辯駁、風來的希煉、極限脫出 |
| 庫洛遊戲 | Kuro Games | 鳴潮、戰雙帕彌什 |
| 鷹角網路 | Hypergryph | 明日方舟、明日方舟：終末地 |
| 亞克系統 | Arc System Works | 聖騎士之戰、蒼翼默示錄 |
| Cygames | Cygames | 碧藍幻想、賽馬娘、超異域公主連結 |
| 小島製作 | Kojima Productions | 死亡擱淺 |
| Falcom | Nihon Falcom | 英雄傳說 軌跡系列、伊蘇 |
| 白金工作室 | PlatinumGames | 魔兵驚天錄、尼爾：自動人形（開發）、異界鎖鏈 |
| SNK | SNK | 拳皇、侍魂、餓狼傳說 |
| 型月 | TYPE-MOON | Fate 系列、魔法使之夜 |
| Nexon | Nexon、Neople、Nexon Games | 楓之谷、跑跑卡丁車、新瑪奇英雄傳、藍色協議 |
| Paradox Interactive | Paradox Interactive、Paradox Development Studio | 歐陸風雲、鋼鐵雄心、王國風雲、群星 |
| 獨立／其他 | 以上以外 | — |
