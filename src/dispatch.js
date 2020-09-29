const mongoClient = require("mongodb").MongoClient;
const config = require("../utils/config").readConfigSync();
const mongoPath = "mongodb://" + config["db"]["user"] + ":" + config["db"]["pwd"] + "@" + config["db"]["ip"] + ":" + config["db"]["port"] + "/" + config["db"]["db"]["business"];
const {ObjectID, DBRef} = require("mongodb");

const routine = require("./routine");


const RADIUS = 6378137;
const HALF_SIZE = Math.PI * RADIUS;

function toEPSG4326(input) {
    let output = [0, 0, input[2]];
    output[0] = (180 * input[0]) / HALF_SIZE;
    output[1] = (360 * Math.atan(Math.exp(input[1] / RADIUS))) / Math.PI - 90;
    return output
}

async function select(date_available, cost) {
    let db = await mongoClient.connect(mongoPath, {useUnifiedTopology: true});
    let time_ = cost / 3; //db.db(config["dispatch"]["speed"]);  出现了几次的问题，这里读数读不出来
    let time = time_ + date_available;
    let parameter = cost * 1 + time * 1;//(db.db.config["dispatch"]["timeWeight"]),db.db(config["dispatch"]["batteryWeight"])
    //console.log([parameter, time]);
    return [parameter, time]
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
        if (record.length === 0) throw {
            code: 400,
            description: "No corresponding order."
        }

        //console.log(ObjectID(record[0].from));
        let garageCol = db.db(config["db"]["db"]["hardware"]).collection("garage");
        //1. from
        let garageFrom = (await garageCol.find({_id: record[0].from.oid}).toArray())[0];
        //2. to
        let garageTo = (await garageCol.find({_id: record[0].to.oid}).toArray())[0];

        //读取飞机数据 (需要知道最终时刻，和最终到达地点)
        let droneCol = db.db(config["db"]["db"]["hardware"]).collection("drone");
        let drones = await droneCol.find({}).toArray();

        //读取task数据
        let taskCol = db.db(config["db"]["db"]["hardware"]).collection("task");
        let pinpointCol = db.db(config["db"]["db"]["map"]).collection("pinpoint");

        let ppFrom = (await pinpointCol.find({_id: garageFrom.center.oid}).toArray())[0];
        let ppTo = (await pinpointCol.find({_id: garageTo.center.oid}).toArray())[0];

        //选取飞机
        let para = 0; //db.db(config["dispatch"]["parameter"]);
        let choose, finalTime, finalPlace, startPlace, dispatch_routine1;
        for (let i = 0; i < drones.length; i++) {
            let dispatch_routine = await routine.get({
                from: drones[0].lastPlace,
                to: garageFrom.center.oid
            });
            let temp = await select(drones[i].finish, dispatch_routine.cost);
            if (para <= temp[0]) {
                choose = i;
                para = temp[0];
                finalTime = temp[1];
                finalPlace = ObjectID(garageFrom.center.oid);
                startPlace = ObjectID(drones[0].lastPlace);
                dispatch_routine1 = dispatch_routine;  //这里可能有问题
            }
        }

        //读取garage中pinpoint的坐标----> 坐标在生成路径时使用

        //1. 起始点
        let pinpointStart = (await pinpointCol.find({_id: startPlace}).toArray())[0];

        //找到指定routine数组(1.去取货地的；2.送货的)
        //1.
        let waypoint_depart = [];
        for (let i = 0; i < dispatch_routine1.routine.length; i++) {
            waypoint_depart.push(toEPSG4326([dispatch_routine1.routine[i][0], dispatch_routine1.routine[i][1], dispatch_routine1.height[i] + config["dispatch"]["height"]]));
            console.log(toEPSG4326([dispatch_routine1.routine[i][0], dispatch_routine1.routine[i][1], dispatch_routine1.height[i] + config["dispatch"]["height"]]));
        }
        waypoint_depart = [toEPSG4326(pinpointStart.coordinate)].concat(waypoint_depart).concat([toEPSG4326(ppFrom.coordinate)]);

        //2.
        let dispatch_routine2 = await routine.get({
            from: garageFrom.center.oid,
            to: garageTo.center.oid
        });

        let waypoint_mission = [];
        for (let i = 0; i < dispatch_routine2.routine.length; i++) {
            waypoint_mission.push(toEPSG4326([dispatch_routine2.routine[i][0], dispatch_routine2.routine[i][1], dispatch_routine2.height[i] + config["dispatch"]["height"]]));
        }
        waypoint_mission = [toEPSG4326(ppFrom.coordinate)].concat(waypoint_mission).concat([toEPSG4326(ppTo.coordinate)]);

        //生成订单task
        let result = await taskCol.insertMany(
            [{
                type: "mission",
                status: "pending",
                drone: DBRef("drone", drones[choose]._id),
                waypoint: waypoint_depart,
                product: record[0].product,
                finish: finalTime,
                lastPlace: finalPlace
            }, {
                type: "mission",
                status: "pending",
                drone: DBRef("drone", drones[choose]._id),
                waypoint: waypoint_mission,
                product: record[0].product,
                finish: finalTime,
                lastPlace: finalPlace
            }]
        )

        //更新order的状态
        await orderCol.updateOne({_id: ObjectID(params.id)}, {
            $set: {
                status: "pending",
                flight: {
                    status: "pending",
                    tasks: result.insertedIds
                }
            }
        });

        await db.close();
        return result

    }
}

module.exports.post({}, {}, {order: "5f731a51250cac4a4d0ccc02"}).then(console.log).catch(console.log);
