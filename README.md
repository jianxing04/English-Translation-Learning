# 英语翻译学习网站

双击根目录下的 **启动学习网站.cmd**，浏览器会打开 <http://127.0.0.1:4173/>。保留启动窗口，关闭窗口或按 Ctrl+C 会停止网站。电脑需要安装 Node.js 20 或更高版本；当前项目不需要安装其他依赖。

也可以在本目录终端运行 `npm start`，或运行 `npm run dev` 后手动打开上述地址。

## 练习流程

1. 从左侧根目录逐层打开文件夹，点击一套题开始练习。
2. 输入当前句子的英文译文，通过句号按钮或上一句、下一句切换。
3. “复制到 AI 评分”文本框会合并当前中文原句和自己的译文。点击文本框后按 Ctrl+A、Ctrl+C，或点击复制按钮，就能粘贴到外部 AI 平台。
4. 点击“显示参考译文”查看当前句子的答案。切换句子后，参考译文会重新隐藏。

中文、我的译文和参考译文也各有独立文本框，可分别 Ctrl+A 全选复制。切换句子或套题会保留本次页面中的输入；关闭或刷新页面后会清空。网站不会改写题库文件，也不会向外部 AI 平台发送内容。

## 添加题库

在项目根目录自由建立分类文件夹，层级、名称都不限。例如：

```text
English-Translation-Learning/
├── CET-6-Translation-Exams/
│   └── December-2025/
│       └── Set-1/
│           ├── Original-Questions.txt
│           └── Reference-Answers.txt
└── Other-Translation-Practice/
    └── Topic-1/
        └── Set-1/
            ├── Original-Questions.txt
            └── Reference-Answers.txt
```

每套题沿用同一文件命名规则，并使用 UTF-8 编码：

- `Original-Questions.txt`：完整中文原题。
- `Reference-Answers.txt`：每组第一行是中文原句，下一行是对应英文译文，句组之间空一行。英文译文可以包含多个英文句子，仍然对应同一条中文原句。

```text
这是第一句中文。
This is the first Chinese sentence.

这是第二句中文。
This is the second Chinese sentence.
```

参考答案中的中文连接后，应与原题一致。新增题库后点击左侧“刷新目录”，不需要修改网页代码或重启网站。隐藏文件夹、符号链接和 `node_modules` 不会作为题库展示。

## 检查

运行 `npm test` 可检查六套现有题目的读取、逐句配对、动态目录发现以及目录访问边界。
"# English-Translation-Learning" 
