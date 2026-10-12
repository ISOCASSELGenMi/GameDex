# lint:arch 自我測試 fixture

每個 `bad-*.ts` 都刻意違反一條 `.dependency-cruiser.cjs` 規則；`test/unit/arch.test.ts` 斷言它們全部被擋下。
這個資料夾不參與型別檢查與 build。
