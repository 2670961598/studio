# 任务：滞留单统计（t05）

当前工作目录是你的工位，里面的 `tickets.json` 是输入（只读，不得修改）。只能读写当前工作目录，不要联网，不要安装任何依赖（只用 Node 内置模块或 shell 自带工具）。

输入：`tickets.json` —— JSON 数组，每项字段 `id` / `title` / `state` / `role` / `lane` / `ageDays` / `costUsd` / `model`。

定义：**滞留单** = `state` 为 `open` 或 `stalled`，且 `ageDays ≥ 3` 的单。其余状态（done / closed / blocked 等）与低龄单一律不计。

请写一个脚本 `stats.mjs`（放在工位根；Node ≥ 24，只用内置模块），运行它生成两份产物：

1. `out/stalled-by-lane.csv`
   - 表头恰好是 `lane,count,costUsd`
   - 每个 lane 一行（只含滞留单数 ≥ 1 的 lane），按 lane 字典序升序
   - `count` = 该 lane 的滞留单数；`costUsd` = 该 lane 滞留单 `costUsd` 之和，保留两位小数（如 `29.19`）
   - 换行符用 LF，无 BOM，文件以单个换行结尾，无空行

2. `out/summary.json`（2 空格缩进，键顺序如下，文件以换行结尾）

   ```json
   {
     "generatedFrom": "tickets.json",
     "totalStalled": <滞留单总数>,
     "byLane": { "<lane>": { "count": <该lane滞留单数>, "costUsd": <该lane成本之和，两位小数> } },
     "topModel": "<滞留单数量最多的 model；并列时取字典序最小者>"
   }
   ```

   尖括号处填实际值：数字不加引号、不带单位；`byLane` 里的 lane 也按字典序排列。

注意：金额先换算成「分」（整数）累加，再除以 100，避免浮点误差。做完即停，除 `stats.mjs` 和 `out/` 下两份产物外不要生成其它文件。
