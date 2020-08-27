const config = require("../utils/config").readConfigSync();

/**
 * 注册一个API
 * @param app Express APP\
 * @param {string} method 方法
     	GET (SELECT): 从服务器取出资源（一项或多项）。
     	POST (CREATE): 在服务器新建一个资源。
     	PUT (UPDATE): 在服务器更新资源（客户端提供改变后的完整资源）。
     	PATCH (UPDATE): 在服务器更新资源（客户端提供改变的属性）。
     	DELETE (DELETE): 从服务器删除资源
 *      大小写不严格
 * @param {string} route 路径，可包含变量，如"flight/:id"
 * @param {function(Array, Array, Array):Object} processor: 注册的processor函数
 *      第一个参数为URL中接受的参数，第二个参数为querystring参数，第三个参数为请求中参数，返回一个标准JSON
 *      如果出现错误，抛出异常
 *      {
 *          code: 返回码,
 *          description: 错误信息
 *      }
 */
module.exports = (app, method, route, processor) => {
    // 如果在函数柯里化支持上下文后可以把这里直接改成生成柯里化后的函数
    if(config.base) route = "/" + config.base + route;

    let fnMethod = eval("app." + method.toLowerCase());

    fnMethod.call(app, route, async (req, res) => {
        try {
            let JSONRet = await processor(req.params, req.query, req.body);
            res.end(JSON.stringify(JSONRet));
        } catch (e) {
            if(e.code) {
                res.status(e.code);
                res.end(e.description);
            } else {
                res.status(500);
                res.end(JSON.stringify({error: "Internal Server Error."}));
                throw e;
            }
        }
    });
};