# 工时打卡 Work Clock

![version](https://img.shields.io/badge/version-1.1.0-blue)
![platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011%20x64-lightgrey)
![license](https://img.shields.io/badge/license-MIT-green)

一个离线的 Windows 桌面打卡工具：每天上下班打卡，自动累计本月工时，并按固定时薪算出这个月能挣多少钱。数据只存在本机，不联网、不需要账号。

| 今日 | 日历 |
| --- | --- |
| ![今日页](docs/screenshots/today.png) | ![日历页](docs/screenshots/calendar.png) |
| **统计** | **设置** |
| ![统计页](docs/screenshots/stats.png) | ![设置页](docs/screenshots/settings.png) |

## 功能

- **自定义安装与数据目录（v1.0.4 新增）**：安装时可自由选择安装目录及本地数据存放路径，支持一键无缝导入旧版本打卡记录，卸载时支持保留个人数据。
- **今日**：一键上班 / 下班打卡，实时显示今天已工作多久、今天赚了多少；打卡时间按半点刻度 ±10 分钟归集，范围外由你选时间点，且不会影响下班打卡；未打卡的时段可以手动补录，跨零点也能记。
- **工作记录与地点**：每天一段文字记录（做了什么）+ 一个上班地点，地点输入框会自动联想最近用过的地点。
- **日历**：按月查看每天的工时和收入，点某一天看当天所有时段、地点和记录。
- **统计**：本月总工时、出勤天数、日均工时、预计收入；每日工时柱状图；明细表（日期 / 星期 / 时段 / 地点 / 工时 / 时薪 / 当日收入 / 记录）可导出 CSV。
- **时薪管理**：时薪只需设置一次；涨薪时新增一条带生效日期的时薪，历史月份金额保持不变。
- **数据安全**：每次保存自动留上一版备份，每天自动归档一份（保留最近 14 份）；数据文件损坏时自动回退到备份；设置页支持导出 / 导入 JSON、恢复历史备份、清空数据。
- **托盘常驻**：点窗口右上角 × 默认隐藏到任务栏托盘，程序继续运行；左键托盘图标恢复窗口，右键菜单可「打开主界面 / 退出」。设置页可关闭该行为，改为点 × 直接退出。

## 环境要求

**使用**：Windows 10 / 11（64 位）。免安装或运行安装程序，不需要 Node.js，也不需要联网。

**从源码开发 / 打包**：Node.js 18 及以上（本项目在 Node v24.19.0 + Windows 10 19044 上验证），Windows 环境。

## 快速开始

1. 从 [Releases](https://github.com/Fanghonglai/WorkCloock/releases) 下载：
   - **安装版**：`WorkClock-1.1.0-Setup.exe`，双击运行安装向导，可在向导中自主选择安装位置与数据存放位置；
   - **绿色免安装版**：`WorkClock-1.1.0-win-x64.zip`，解压即用。
2. 第一次打开会弹出「先设置你的时薪」，填上时薪（元/小时）和生效日期，保存。
3. 到公司点「上班打卡」，下班点「下班打卡」。忘了打卡就在日历页或今日页点「补录时段」。
4. 月底打开「统计」页，看本月总工时和预计收入，需要的话点「导出 CSV」。

数据默认保存在程序目录下的 `data` 文件夹（若使用安装版指定了数据目录，则保存在指定目录）。点 × 默认只是隐藏到托盘，要彻底退出请用托盘右键菜单的「退出」。

## 一个完整的工作日

1. **设置时薪**（只需一次）：设置页 → 时薪填 `28`、生效日期选入职或本月 1 日 → 保存。
2. **上班打卡**：今日页点蓝色按钮「上班打卡」。按钮变为「下班打卡」，下方出现一条进行中的时段，工时按真实时间每秒刷新；落在半点刻度前后 10 分钟内会自动归到该刻度，落在范围外则弹出「这次打卡记在几点？」让你只选本次打卡时间点，时段继续计时、下班打卡不受影响。
3. **记录工作内容**：在「工作记录」卡里填地点（如 `公司 3F`）和当天做了什么，失焦或停顿后自动保存，右侧显示「已保存」。
4. **下班打卡**：点「下班打卡」，提示「已下班（记为 …）」，当天工时定稿。
5. **补录**：如果忘了打卡，点「补录时段」，选日期、开始 / 结束时间，也可以顺手填当天的工作地点；结束时间早于开始时间说明跨了零点，勾选「次日结束」。日历页的「编辑工作记录」同样可以补地点和备注。
6. **查看与导出**：统计页确认本月工时与收入，点「导出 CSV」用 Excel / WPS 打开（已带 UTF-8 BOM，中文不乱码）。

## 计算规则

- 工时归到**打卡开始那天**；跨零点的那一段算开始日（例如 22:00 到次日 01:30 记在开始日）。
- 一天可以有多段打卡；正在进行的时段按**真实当前时间**实时计入，不再对「现在」做归整。
- **半点刻度 ±10 分钟归集**：全天 48 个刻度（`HH:00` 与 `HH:30`），打卡时刻先截断到分钟，秒与毫秒不参与。落在某个刻度前后各 10 分钟内（两端都含）就记为该刻度：09:08 → 09:00、09:33 → 09:30、09:10 → 09:00、09:20 → 09:30；23:55 会归到次日 00:00。窗口之间留有空档（如 09:11–09:19、09:41–09:49），落在空档里不自动归整、不猜测。
- **范围外由你选时间点**：打卡落在空档时，先按实际分钟正常记录（上班立即开始计时），同时弹出「单点选择页」——给出附近两个半点刻度按钮，也可在「其他时间」手填任意分钟。确认后只改这一次打卡的端点，另一端保持原样：选上班时间点不会顺带写下下班时间，进行中的时段继续计时；下班打卡是独立的一次动作，只写下班端点。取消则保留实际打卡时刻，随时可编辑。
- **补录与编辑**：填的时间同样按上面的规则处理——窗口内归到刻度，窗口外按填写的分钟记录；归集后下班不晚于上班会提示调整，不会生成 0 时长段。编辑进行中的记录时下班时间默认是空的，留空就只改上班时间、不会结束时段。
- 某天的时薪 = 生效日期不晚于该天的**最新一条**时薪；如果该天早于最早一条时薪的生效日期，则回退使用最早一条。
- 当日收入 = 该段毫秒数 ÷ 3600000 × 当天时薪；月总额把各天金额相加后四舍五入到分。不做加班倍率、节假日倍率，也不按 15 分钟取整。
- **修改时薪的影响**：新增一条时薪只对该生效日期及之后生效，之前月份金额不变；如果删除或修改某条历史时薪，它覆盖的时间段会被重新计算。

## 数据、备份与迁移

| 文件 | 说明 |
| --- | --- |
| `%APPDATA%\work-clock\data.json` | 当前数据（打卡记录、时薪、备注、地点、窗口位置） |
| `%APPDATA%\work-clock\data.bak.json` | 上一次保存前的自动备份 |
| `%APPDATA%\work-clock\backups\data-YYYYMMDD.json` | 每天首次写入时归档，保留最近 14 份 |

- 启动时如果 `data.json` 读不出来（例如被手动改坏），会依次尝试 `data.bak.json` 和最近的每日备份，并在界面顶部提示发生过的回退；坏文件会保留为 `data.corrupt-<时间戳>.json` 方便排查。
- 换电脑：设置页「导出数据」得到 JSON 文件，在新机器上「导入数据」即可；导入 / 恢复备份前会自动再留一份安全备份。
- 清空数据会删除全部记录，操作前有二次确认。

## 工程结构

```
work-clock/
├─ package.json            # 脚本、electron-builder 打包配置
├─ LICENSE                 # MIT 许可证
├─ CHANGELOG.md            # 版本更新记录
├─ README.md               # 项目说明
├─ build/icon.png          # 应用与安装包图标
├─ src/
│  ├─ main/
│  │  ├─ main.js           # 主进程：窗口、IPC、CSV/JSON 导出、冒烟截图模式
│  │  └─ store.js          # 数据层：读写、校验、去重、备份与损坏恢复
│  ├─ preload.js           # contextBridge 暴露最小 API
│  ├─ shared/calc.js       # 纯计算核心（时长、时薪分段、月统计、格式化），主/渲染进程共用
│  └─ renderer/
│     ├─ index.html        # 四个页面骨架
│     ├─ styles.css        # 界面样式
│     └─ app.js            # 渲染与交互逻辑
├─ test/
│  ├─ calc.test.js         # 计算核心 19 个用例
│  └─ store.test.js        # 数据层 18 个用例
├─ docs/screenshots/       # 界面截图
└─ dist/                   # 打包产物（构建生成，已被 .gitignore 忽略）
```

## 开发与测试

```powershell
cd work-clock
cmd /c npm install          # PowerShell 若拦截 npm.ps1，用 cmd /c npm.cmd install
cmd /c npm start            # 本地启动应用
cmd /c npm test             # 依次运行 calc 与 store 测试
```

也可以单独运行某个测试文件（不通过 node --test，避免子进程权限问题）：

```powershell
node test/calc.test.js
node test/store.test.js
```

调试时建议用独立的数据目录，避免污染真实数据。程序启动时优先读取**可执行文件同目录**下的 `workclock.config.json`（不读环境变量）：

```json
{ "dataDir": "D:/project/开发/WorkClock/.cache/debug-data" }
```

- 开发模式（`npm start`）：放到 `node_modules\electron\dist\`；
- 绿色打包版：放到 exe 同目录（`dist\win-unpacked\`）；安装版由安装向导写入安装目录。

启动后到「设置 → 数据路径」确认生效目录；测完删除该配置文件和临时数据目录即可。

### 手工验收要点

改过打卡归集规则后，建议按以下顺序在真机上点一遍：

1. 先 `npm test`（计算核心与数据层用例），再 `npm start`；首次需 `cmd /c npm install`。
2. 设置一条时薪，便于核对金额；导入一份旧版本备份，确认历史记录（含 09:30 / 18:30 这类半点）正常显示。
3. 窗口内打卡（如 09:00、09:08、09:10、09:20、09:30、09:40）应自动归到对应刻度且不弹窗；23:55 应归到次日 00:00。
4. 窗口外打卡（每小时 `HH:11–HH:19`、`HH:41–HH:49`）应立即开始计时并弹出「这次打卡记在几点？」；确认页面只有本次打卡时间点，没有下班时间输入框。
5. 分别验证：选刻度、手填任意分钟、取消（保留实际时刻）、不选直接确定（提示）、上班选择后时段仍在进行中且工时持续增长、下班打卡独立且只改下班端点。
6. 编辑进行中的记录：下班时间应默认为空，留空保存只改上班时间、不结束时段。
7. 回归：补录/编辑、跨零点、重叠拒绝、0 时长拒绝、日历与统计金额、CSV 导出、JSON 备份与恢复、托盘与单实例。
8. 打包后再跑一遍第 4、5 条（开发模式与打包模式的 CSP、preload 环境不同）；确认版本号、CHANGELOG 日期与 Releases 资产一致。

### 打包

```powershell
$env:TEMP = "$PWD\.cache\tmp"; $env:TMP = "$PWD\.cache\tmp"
$env:ELECTRON_CACHE = "$PWD\.cache\electron"
$env:ELECTRON_BUILDER_CACHE = "$PWD\.cache\builder"
$env:CSC_IDENTITY_AUTO_DISCOVERY = "false"
cmd /c npm run dist
```

产物为 `dist\WorkClock-<版本>.exe`（portable 免安装）。国内网络可再设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 与 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`。打包第一次运行会下载 Electron 与 NSIS 资源，比较慢。

### 发布到 GitHub Releases

仓库没有 CI：Releases 里的 `Setup.exe` 与 `-win-x64.zip` 是手工上传的二进制资产，`git push` 不会重建它们。只推源码，下载者拿到的仍是旧版本程序，而文档已写着新规则。

**改版本号**：`npm version <版本> --no-git-tag-version` 会同步 `package.json` 与 `package-lock.json`；此外还要改 `installer/Common.cs` 的 `Consts.Version`（控制面板、安装向导标题、注册表）、`installer/app.manifest` 的 `assemblyIdentity version`（四段式）、`build-installer.ps1` 的两个输出文件名、README 顶部 badge 与两个下载文件名及底部「当前版本」、CHANGELOG 的版本标题与日期。

**构建发布资产**：

```powershell
cmd /c npm run dist:dir
# 把 dist\win-unpacked 复制到项目根的 win-unpacked\
powershell -NoProfile -ExecutionPolicy Bypass -File .\asar.ps1 extract .\win-unpacked\resources\app.asar .\app
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-installer.ps1
```

`build-installer.ps1` 会用项目根的 `app\` 重新打包 `app.asar` 覆盖进安装包，务必确认 `app\` 来自本次源码（检查其中的 `src/shared/calc.js` 是否含 `snapPunch`），否则安装包里装的仍是旧规则。产物为 `dist\WorkClock-<版本>-Setup.exe` 与 `dist\WorkClock-<版本>-win-x64.zip`。

在打包产物上跑一遍「手工验收要点」第 4、5 条，确认无误后新建 Release `v<版本>` 上传这两个文件，Release notes 从 CHANGELOG 复制；若沿用旧 Release，需先删除同名旧资产（GitHub 不允许同名覆盖）。

## 常见问题

- **双击 exe 没反应**：zip 版要先完整解压再运行（不要在压缩包里直接双击）；若还不行，检查杀毒软件是否拦截，或改用 `npm run dist:dir` 生成的 `dist\win-unpacked\工时打卡.exe`。
- **终端里 `npm start` 起不来**：如果环境里设置过 `ELECTRON_RUN_AS_NODE=1`，先执行 `Remove-Item Env:ELECTRON_RUN_AS_NODE` 再启动。
- **点了 × 程序还在运行**：默认开启“关闭到托盘”，这是正常行为；要彻底退出，右键任务栏托盘里的时钟图标 →「退出」，或在设置页关闭该开关。
- **改了时薪，上个月金额变了**：说明改的是历史时薪记录；应当新增一条时薪并选择新的生效日期，历史月份就不会动。
- **跨零点的班怎么记**：正常打卡即可，工时算在开始那天；补录时勾选「次日结束」。
- **数据文件被改坏**：重新打开软件，会自动从备份回退并在顶部提示；确认无误后可在设置页手动恢复某天的备份。
- **打卡时弹出「这次打卡记在几点？」**：说明这次打卡落在半点刻度 ±10 分钟范围外，软件不替你自动归整。选一个刻度，或在「其他时间」手填任意分钟即可；只改这次打卡的时间点，不会连带写上或改掉另一端的打卡时间。直接关掉也没关系，会按实际打卡时刻保留，工时不中断。

## 已知限制

- 单机单用户，没有云同步和多设备合并。
- 只统计软件里记录的时间，不读取考勤系统。
- CSV 是 UTF-8 BOM 编码，适合 Excel / WPS；其他工具若显示乱码请按 UTF-8 打开。
- 没有自动更新，也不随源码提交自动升级。安装版直接运行新版 Setup.exe 覆盖安装（向导会预填原安装目录与数据目录）；绿色版用新 zip 覆盖程序文件，保留 `data\` 目录或 `workclock.config.json` 指向的数据目录。数据格式未变，历史记录不会被重新归集，只有升级后的新打卡按新规则处理。

## 版本与更新

当前版本 **1.1.0**，变更记录见 [CHANGELOG.md](CHANGELOG.md)。遇到问题或有建议，欢迎提 [GitHub Issue](https://github.com/Fanghonglai/WorkCloock/issues)。

## 许可

[MIT License](LICENSE) © 2026 Fanghonglai