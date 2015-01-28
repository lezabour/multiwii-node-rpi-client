//var Protocol = require('./MultiWiiSerialProtocol').Protocol;
//
//
//var pr = new Protocol('/dev/ttyAMA0');
//pr.on('open', function () {
//    pr.status(function (error, data) {
//        console.log(data);
//        pr.close();
//    });
//});

var config = require('./config');

var SerialOverTcp = require('./SerialOverTcpFactory').SerialOverTcp;

var tcp = new SerialOverTcp(config.tcp.host, config.tcp.port, config.serial);