const mongoClient = require("mongodb").MongoClient;
const config = require("../utils/config").readConfigSync();
const mongoPath = "mongodb://" + config["db"]["user"] + ":" + config["db"]["pwd"] + "@" + config["db"]["ip"] + ":" + config["db"]["port"] + "/" + config["db"]["db"]["business"];
const {ObjectID} = require("mongodb");
const {DBRef} = require("mongodb");


async function select(date_available, cost) {
    let db = await mongoClient.connect(mongoPath, {useUnifiedTopology: true});
    let time_ = cost/3; //db.db(config["dispatch"]["speed"]);  出现了几次的问题，这里读数读不出来
    let time = time_ + date_available;
    let parameter = cost * 1 + time * 1;//(db.db.config["dispatch"]["timeWeight"]),db.db(config["dispatch"]["batteryWeight"])
    //console.log([parameter, time]);
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

        //console.log(ObjectID(record[0].from));
        let pinpointCol = db.db(config["db"]["db"]["map"]).collection("pinpoint");
        //1. from
        let garageFrom = await pinpointCol.find({_id: ObjectID(record[0].from)}).toArray();
        //2. to
        let garageTo = await pinpointCol.find({_id: ObjectID(record[0].to)}).toArray();


        //读取flight
        let flightCol = db.db(config["db"]["db"]["business"]).collection("flight");


        //读取飞机数据 (需要知道最终时刻，和最终到达地点)
        let droneCol = db.db(config["db"]["db"]["hardware"]).collection("drone");
        let drones = await droneCol.find({}).toArray();

        //读取task数据
        let taskCol = db.db(config["db"]["db"]["hardware"]).collection("drone");


        //读取路径path/routine信息
        let pathCol = db.db(config["db"]["db"]["map"]).collection("path");
        let routineCol = db.db(config["db"]["db"]["map"]).collection("routine");


        //选取飞机
        let para = 0; //db.db(config["dispatch"]["parameter"]);
        let choose, finalTime, finalPlace, startPlace, dispatch_routine1;
        for (let i = 0; i < drones.length ; i++){
            let dispatch_path = await pathCol.find({$and: [{terminal: (DBRef("pinpoint", ObjectID(garageFrom[0]._id)))}, {terminal: DBRef("pinpoint", ObjectID(drones[i].lastPlace))}]}).toArray();
            //console.log(garageFrom[0]._id);
            //console.log(drones[0].lastPlace);
            //console.log(dispatch_path[0]._id);
            let dispatch_routine = await routineCol.find({_id: ObjectID("5f72a5a300277121e0145849")}).toArray();//dispatch_path[0]._id，这里找不到对应的路径，如果用dispatch_path[0]._id带进去所得到的id不在routine的column里面
            //console.log(dispatch_routine[0].cost);
            let temp = await select(drones[i].finish,dispatch_routine[0].cost);
            //console.log(temp);
            if (para <= temp[0]){
                choose = i; para = temp[0]; finalTime = temp[1]; finalPlace = ObjectID(record[0].to); startPlace = ObjectID(drones[0].lastPlace);
                dispatch_routine1 = dispatch_routine[0];  //这里可能有问题
            }
            //console.log(temp[0]);
            //console.log(dispatch_routine1);
        }

        //读取garage中pinpoint的坐标----> 坐标在生成路径时使用

        //1. 起始点
        let pinpointStart = await pinpointCol.find({_id: startPlace}).toArray();
        //2. from   为garageFrom (为pinpoint类型的)
        //3. to     为garageTo



        //找到指定routine数组(1.去取货地的；2.送货的)
        //1.
        let temp1 = [];
        for (let i=0; i<dispatch_routine1.length; i++){
            temp1.push([dispatch_routine1[0].routine[i][0], dispatch_routine1[0].routine[i][1], dispatch_routine1[0].height[i]+db.db(config["db"]["db"]["dispatch"]["height"])]);
        }
        let temp1_ = pinpointStart[0].coordinate.concat(temp1);
        let waypoint1 = toEPSG4326(temp1_.concat(garageFrom[0].coordinate));
        //2.
        let dispatch_path2 = await pathCol.find({$and: [{terminal: (DBRef("pinpoint", ObjectID(record[0].from)))}, {terminal: DBRef("pinpoint", ObjectID(drones[0].lastPlace))}]}).toArray();
        console.log(dispatch_path2);
        //let dispatch_path2 = await pathCol.find({$and: [{terminal: ObjectID(record[0].from)}, {terminal: ObjectID(drones[0].lastPlace)}]}).toArray();
        let dispatch_routine2 = await routineCol.find({_id: ObjectID(dispatch_path2[0]._id)}).toArray();
        let temp2 = [];
        for (let i=0; i< dispatch_routine2.length; i++){
            temp2.push([dispatch_routine2[0].routine[i][0], dispatch_routine2[0].routine[i][1], dispatch_routine2[0].height[i]+db.db(config["db"]["db"]["dispatch"]["height"])]);
        }
        let temp2_ = garageFrom[0].coordinate.concat(temp2);
        let waypoint2 = toEPSG4326(temp2_.concat(garageTo[0].coordinate));

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