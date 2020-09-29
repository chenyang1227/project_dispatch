const mongoClient = require("mongodb").MongoClient;
const config = require("../utils/config").readConfigSync();
const mongoPath = "mongodb://" + config["db"]["user"] + ":" + config["db"]["pwd"] + "@" + config["db"]["ip"] + ":" + config["db"]["port"] + "/" + config["db"]["db"]["business"];
const {ObjectID} = require("mongodb");

function priorityInsert(queue, elt) {
    if(queue.length === 0) {
        queue.push(elt);
        return 0;
    }
    let l = 0, r = queue.length - 1;
    while(r - l >= 2) {
         let m = Math.ceil((l + r) / 2);
         if(queue[m].weight > elt.weight) {
             r = m;
         } else {
             l = m;
         }
    }
    if(l === 0 && queue[0].weight > elt.weight) {
        queue.unshift(elt);
        return 0;
    } else if(r === queue.length - 1 && queue[r].weight <= elt.weight) {
        queue.push(elt);
        return r;
    } else {
        queue.splice(r, 0, elt);
    }
}

module.exports = {
    async get(params) {
        let from;
        try {
            from = ObjectID(params.from);
        } catch(e) {
            throw {
                code: 400,
                description: "Invalid arguments."
            }
        }

        let to;
        try {
            to = ObjectID(params.to);
        } catch(e) {
            throw {
                code: 400,
                description: "Invalid arguments."
            }
        }

        let client = await mongoClient.connect(mongoPath, {useUnifiedTopology: true});
        let mapDB = client.db("map");

        let fromPin = (await mapDB.collection("pinpoint").find({_id: from}).toArray())[0];
        if(!fromPin) {
            throw {
                code: 400,
                description: "Cannot find garage " + params.from
            }
        }

        // USE Dijkstra Alg

        let open = [{
            vertex: from,
            weight: 0,
            routine: [fromPin.coordinate.slice(0, 2)],
            height: [fromPin.coordinate[2] || 0]
        }];
        let close = [];
        while(1) {
            // 0. 从queue中shift出节点
            let cur = open[0];
            if(cur.vertex.toString() === to.toString()) {
                await client.close();
                return {
                    routine: cur.routine,
                    height: cur.height,
                    cost: cur.weight
                };
            }
            open.shift();
            close.push(cur);

            // 1. 找到相邻节点 并加入queue
            let edges = (await mapDB.collection("path").find({"terminal.$id": cur.vertex}).toArray());
            if(edges.length === 0) continue; // 到头了

            for(let i = 0; i < edges.length; i++) {
                // 0. 获取边信息
                let edge = (await mapDB.collection("routine").find({_id: edges[i].routine.oid}).toArray())[0];

                let neighbour = edges[i].terminal[0].oid.toString() === cur.vertex.toString() ? edges[i].terminal[1].oid : edges[i].terminal[0].oid;
                if(close.find((e) => {return e.vertex.toString() === neighbour.toString()})) continue;
                let newWeight = cur.weight + edge.cost;
                let newRoutine = cur.routine.concat(edge.routine);
                let newHeight = cur.height.concat(edge.height)
                // 1.1. 检查是否在Queue
                let index = open.indexOf(open.find((e) => {return e.vertex.toString() === neighbour.toString()}));
                if(index !== -1) {
                    // 1.2. 若在，尝试更新weight
                    if(newWeight < open[index].weight) {
                        open[index].weight = newWeight;
                        open[index].routine = newRoutine;
                        open[index].height = newHeight;
                    }
                } else {
                    // 1.3. 若不在，计算weight并添加
                    priorityInsert(open, {
                        vertex: neighbour,
                        weight: newWeight,
                        routine: newRoutine,
                        height: newHeight
                    })
                }
            }
        }
    }
}
