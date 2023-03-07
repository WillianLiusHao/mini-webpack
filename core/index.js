
const config = require('../example/webpack.config');
const webpack = require('./webpack');

// 工作流程-第一阶段：初始化
const compiler = webpack(config);

// 工作流程第二、三阶段：构建和打包
compiler.run((err, stats) => {
  if (err) {
    console.log(err, 'err');
  }
  // ...
})
