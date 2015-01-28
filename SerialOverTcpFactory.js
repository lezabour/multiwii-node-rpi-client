var SerialPort = require('serialport').SerialPort;
var net = require('net');
var util = require('util');
var config = require('./config');

function SerialOverTcpFactory() {
    "use strict";

    function SerialOverTcp(host, port, serial) {
        var tcp, sp;

        tcp = new net.Socket();

        sp = new SerialPort(serial, {
            baudRate: 115200
        });

        tcp.on('close', function () {
            console.log('Reconnecting...');
            tcp.connect(port, host, function () {
                tcp.write('API{' + config.api + '}');
                console.log('Reconnected');
            });
        });

        tcp.on('error', function (error) {
            console.log('Error: ' + error);
        });

        console.log('Connecting...');
        tcp.connect(port, host, function () {
            tcp.write('API{' + config.api + '}');

            sp.on('data', function (data) {
//                console.log('SP: Received ', data);
                tcp.write(data);
            });
            console.log('TCP: Connected');
        });

        sp.on('open', function () {
            tcp.on('data', function (data) {
//                console.log('TCP: Received ', data);
                sp.write(data);
            });
            console.log('SP: Connected');
        });
    }

    this.SerialOverTcp = SerialOverTcp;
}

module.exports = new SerialOverTcpFactory();