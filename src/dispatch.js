const mongoClient = require("mongodb").MongoClient;
const config = require("../utils/config").readConfigSync();
const mongoPath = "mongodb://" + config["db"]["user"] + ":" + config["db"]["pwd"] + "@" + config["db"]["ip"] + ":" + config["db"]["port"] + "/" + config["db"]["db"]["business"];
const {ObjectID} = require("mongodb");


async function select(date_available, cost) {
    let db = await mongoClient.connect(mongoPath, {useUnifiedTopology: true});
    let time_ = cost/db.db(config["db"]["db"]["dispatch"]["speed"]);
    let time = time_ + date_available
    let parameter = cost * db.db(config["db"]["db"]["dispatch"]["batteryWeight"]) + time * db.db(config["db"]["db"]["dispatch"]["timeWeight"]);
    return [parameter, time]
}



var RADIUS = 6378137;
var HALF_SIZE = Math.PI * RADIUS;


async function toEPSG4326(input) {
    let output = [0, 0, input[2]];
    output[0] = (180 * input[0]) / HALF_SIZE;
    output[1] = (360 * Math.atan(Math.exp(input[1] / RADIUS)));
    return output
}


module.exports = {
    async post(params, qs, body) {
        // 检验
        if (!body.hasOwnProperty("order")) throw {
            code: 400,
            description: "Invalid arguments."
        }
        let order;
        try {
            order = ObjectID(body.order);
        } catch (e) {
            throw {
                code: 400,
                description: "Invalid arguments2."
            }
        }

        // 读取信息
        let db = await mongoClient.connect(mongoPath, {useUnifiedTopology: true});

        //读取订单 order  (需要知道from和to的id)
        let orderCol = db.db(config["db"]["db"]["business"]).collection("order");
        let record = await orderCol.find({_id: order, status: "unplanned"}).toArray();
        if(record.length === 0) throw {
            code: 400,
            description: "No corresponding order."
        }


        //读取order的中from/to的两个pinpoint,在garage中找----> pinpoint在找path中用
        let garageCol = db.db(config["db"]["db"]["hardware"]).collection("garage");
        //1. from
        let garageFrom = await garageCol.find({_id: ObjectID(record[0].from)}).toArray();
        //2. to
        let garageTo = await garageCol.find({_id: ObjectID(record[0].to)}).toArray();


        //读取flight
        let flightCol = db.db(config["db"]["db"]["business"]).collection("flight");


        //读取飞机数据 (需要知道最终时刻，和最终到达地点)
        let droneCol = db.db(config["db"]["db"]["hardware"]).collection("drone");
        let drones = await droneCol.find({}).toArray();

        //读取task数据
        let taskCol = db.db(config["db"]["db"]["hardware"]).collection("drone");


        //读取路径path/routine信息
        let pathCol = db.db(config["db"]["db"]["map"]).collection("path");
        let routineCol = db.db(config["db"]["db"]["map"]).collection("path");

        //选取飞机
        let para = db.db(config["dispatch"]["parameter"]);
        let choose, finalTime, finalPlace, startPlace, dispatch_routine1;
        for (let i = 0; i < drones.length ; i++){
            //let final_task = await taskCol.find({_id: ObjectID(drones[i].tasks[drones[i].tasks.length-1])}).toArray();
            let dispatch_path = await pathCol.find({$and: [{terminal: ObjectID(garageFrom[0].center)}, {terminal: ObjectID(droneCol[i].lastPlace)}]}).toArray();
            let dispatch_routine = await routineCol.find({_id: ObjectID(dispatch_path[0].routine)}).toArray();
            let temp = select(droneCol[i].finish,dispatch_routine[0].cost);
            if (para < temp[0]){
                choose = i; para = temp[0]; finalTime = temp[1]; finalPlace = ObjectID(record[0].to); startPlace = ObjectID(final_task[0].lastPlace);
                dispatch_routine1 = dispatch_routine;
            }
        }

        //读取garage中pinpoint的坐标----> 坐标在生成路径时使用
        let pinpointCol = db.db(config["db"]["db"]["map"]).collection("pinpoint");
        //1. 起始点
        let pinpointStart = await pinpointCol.find({_id: startPlace}).toArray();
        //2. from
        let pinpointFrom = await pinpointCol.find({_id: ObjectID(garageFrom[0].center)}).toArray();
        //3. to
        let pinpointTo = await pinpointCol.find({_id: ObjectID(garageTo[0].center)}).toArray();


        //找到指定routine数组(1.去取货地的；2.送货的)
        //1.
        let temp1 = [];
        for (let i=0; i< dispatch_routine1.length; i++){
            temp1.push([dispatch_routine1[0].routine[i][0], dispatch_routine1[0].routine[i][1], dispatch_routine1[0].height[i]+db.db(config["db"]["db"]["dispatch"]["height"])]);
        }
        let temp1_ = pinpointStart[0].coordinate.concat(temp1);
        let waypoint1 = toEPSG4326(temp1_.concat(pinpointFrom[0].coordinate));
        //2.
        let dispatch_path2 = await pathCol.find({$and: [{terminal: ObjectID(record[0].from)}, {terminal: ObjectID(final_task[0].lastPlace)}]}).toArray();
        let dispatch_routine2 = await routineCol.find({_id: ObjectID(dispatch_path2[0].routine)}).toArray();
        let temp2 = [];
        for (let i=0; i< dispatch_routine2.length; i++){
            temp2.push([dispatch_routine2[0].routine[i][0], dispatch_routine2[0].routine[i][1], dispatch_routine2[0].height[i]+db.db(config["db"]["db"]["dispatch"]["height"])]);
        }
        let temp2_ = pinpointFrom[0].coordinate.concat(temp2);
        let waypoint2 = toEPSG4326(temp2_.concat(pinpointTo[0].coordinate));

        //生成订单task
        let result = await taskCol.insertMany(
            [{
                type: "mission",
                drone: choose,
                waypoint: waypoint1,
                product: record[0].product,
                finish: finalTime,
                lastPlace: finalPlace
            }, {
                type: "load",
                drone: choose,
                product: record[0].product,
                garage: record[0].from,
                status: "pending",
                finish: finalTime,
                lastPlace: finalPlace
                }, {
                type: "mission",
                drone: choose,
                waypoint: waypoint2,
                product: record[0].product,
                finish: finalTime,
                lastPlace: finalPlace
            }, {
                type: "load",
                drone: choose,
                product: record[0].product,
                garage: record[0].to,
                status: "pending",
                finish: finalTime,
                lastPlace: finalPlace
            }]
        )


        //加入到drone(array tasks)
        await droneCol.updateOne({_id: drones[choose]._id}, {
            $push: {
                tasks: {
                    $each: result.insertedIds
                }
            }
        })

        //加入到flight(flight tasks)
        await flightCol.updateOne({
            $push: {
                tasks: {
                    $each: result.insertedIds
                }
            }
        })

        //更新order的状态
        await orderCol.updateOne({_id: ObjectID(params.id), status: "unplanned"}, {$set: {
                status: "pending",
                flight: {
                    status: "pending",
                    tasks: result.insertedIds
                }
            }});


    await db.close();
    return result

    }
}

module.exports.post({}, {}, {order:"5f48de36d4306467195b543c"}).then(console.log).catch(console.log);