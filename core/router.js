const register = require("./registration");

module.exports = (app) => {
    // 在这里写所有注册函数
    let dispatch = require("../src/dispatch.js");
    register(app, "post", "/dispatch", dispatch.post);
};
