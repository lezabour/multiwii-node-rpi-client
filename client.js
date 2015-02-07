var config = require('./config');

var TcpClient = require('multiwii-msp').TcpClient;

var client = new TcpClient(config.tcp.host, config.tcp.port, config.serial.port, config.serial.baudRate, true);