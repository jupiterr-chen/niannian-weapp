// 副作用引导模块：import 它就会加载 .env.local。
//
// 为什么不直接在脚本里调 loadDotEnv()：ESM 的静态 import 会在模块求值阶段
// 全部先跑完，等轮到脚本正文里的函数调用时，lib/env.ts 早就已经用空的
// process.env 初始化过了。而本项目没有 "type": "module"，被转成 CJS 输出，
// 顶层 await 也用不了，所以不能靠 `await import()` 绕开。
//
// 解法是把加载动作本身变成一个 import 的副作用，并把这一行放在所有其他
// import 之前——CJS 转换后 require 按源码顺序执行，顺序有保证。
import { loadDotEnv } from "./_env";

loadDotEnv();
