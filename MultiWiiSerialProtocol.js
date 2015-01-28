var EventEmitter = require('events').EventEmitter;
var SerialPort = require('serialport').SerialPort;
var util = require('util');

function MultiWiiSerialProtocol() {
    "use strict";

    var mwsSelf = this;

    function Device(serial) {
        var device = this;

        this.serial = serial;
        this.queue = [];
        this.busy = false;
        this.current = null;
        this.timeout = null;

        serial.on('data', function (code, data) {
            if (!device.current) {
                return;
            }
            clearTimeout(device.timeout);

            if (device.current.code === code) {
                device.current.callback(null, data);
            }
            device.processQueue();
        });
    }

    Device.prototype.send = function (code, data, callback, wait) {
        this.queue.push({
                            code    : code,
                            data    : data,
                            callback: callback,
                            wait    : wait === undefined ? 1000 : wait
                        });
        if (this.busy) {
            return;
        }
        this.busy = true;
        this.processQueue();
    };

    Device.prototype.processQueue = function () {
        var device, next;

        device = this;
        next = this.queue.shift();

        if (!next) {
            this.busy = false;
            return;
        }

        this.current = next;
        this.serial.write(this.current.data, function () {
            device.serial.drain(function () {
                device.timeout = setTimeout(function () {
                    device.processQueue();
                }, device.current.wait);
            });
        });
    };

    function Command(device, code, length) {
        this.device = device;
        this.code = code;
        this.buffer = new Buffer(6 + length);
        this.buffer.write('$M<');
        this.buffer.writeUInt8(length, 3);
        this.buffer.writeUInt8(code, 4);
        this.data = [];
    }

    Command.prototype.send = function (callback) {
        var i, crc;

        crc = 0x00;
        for (i = 3; i < this.buffer.length - 1; i = i + 1) {
            crc ^= this.buffer.readUInt8(i);
        }

        this.buffer.writeUInt8(crc, this.buffer.length - 1);

        this.device.send(this.code, this.buffer, callback);
    };

    function Protocol(port, options) {
        var protocolSelf = this;

        this.serial = new SerialPort(port, {
            baudRate: options !== undefined && options.hasOwnProperty('baudRate') ? options.baudRate : 115200,
            parser  : (function () {
                var data, validatePackageOffset;

                data = [];

                validatePackageOffset = function (emitter, data) {
                    var i, j, length, code, crc, buffer;
                    for (i = 0; i < data.length; i) {
                        if (data[i] !== 36) {
                            i = i + 1;
                        } else if (data[i + 1] !== 77) {
                            i = i + 2;
                        } else if (data[i + 2] !== 62) {
                            i = i + 3;
                        } else if (data[i + 3] <= data.length - 6 - i) {
                            length = data[i + 3];
                            code = data[i + 4];
                            crc = 0x00 ^ length ^ code;
                            for (j = 0; j < length; j = j + 1) {
                                crc ^= data[i + j + 5];
                            }
                            if (crc !== data[i + 5 + length]) {
                                i = i + 5 + length;
                            } else {
                                buffer = new Buffer(length);
                                for (j = 0; j < length; j = j + 1) {
                                    buffer.writeUInt8(data[i + j + 5], j);
                                }
                                emitter.emit('data', code, buffer);
                                return i + 5 + length + 1;
                            }
                        } else {
                            return i;
                        }
                    }

                    return i;
                };

                return function (emitter, buffer) {
                    var i, offset;

                    for (i = 0; i < buffer.length; i = i + 1) {
                        data[data.length] = buffer.readUInt8(i);
                    }

                    offset = validatePackageOffset(emitter, data);
                    data = data.slice(offset);
                };
            }())
        });

        this.serial.on('open', function () {
            protocolSelf.emit('open');
        });

        this.device = new Device(this.serial);
    }

    util.inherits(Protocol, EventEmitter);

    Protocol.prototype.ident = function (callback) {
        var command = new Command(this.device, 100, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }
            callback(null, {
                version   : data.readUInt8(0),
                multiType : data.readUInt8(1),
                mspVersion: data.readUInt8(2),
                capability: data.readUInt32LE(3)
            });
        });
    };

    Protocol.prototype.status = function (callback) {
        var command = new Command(this.device, 101, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }
            callback(null, {
                cycleTime           : data.readUInt16LE(0),
                i2cErrorCount       : data.readUInt16LE(1),
                sensorPresent       : data.readUInt16LE(2),
                boxActivation       : data.readUInt32LE(3),
                currentSettingNumber: data.readUInt8(4)
            });
        });
    };

    Protocol.prototype.rawImu = function (callback) {
        var command = new Command(this.device, 102, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }
            callback(null, {
                gyro: {
                    x: data.readInt16LE(0),
                    y: data.readInt16LE(2),
                    z: data.readInt16LE(4)
                },
                acc : {
                    x: data.readInt16LE(6),
                    y: data.readInt16LE(8),
                    z: data.readInt16LE(10)
                },
                mag : {
                    x: data.readInt16LE(12),
                    y: data.readInt16LE(14),
                    z: data.readInt16LE(16)
                }
            });
        });
    };

    Protocol.prototype.servo = function (callback) {
        var command = new Command(this.device, 103, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, [
                data.readUInt16LE(0),
                data.readUInt16LE(2),
                data.readUInt16LE(4),
                data.readUInt16LE(6),
                data.readUInt16LE(8),
                data.readUInt16LE(10),
                data.readUInt16LE(12),
                data.readUInt16LE(14)
            ]);
        });
    };

    Protocol.prototype.motor = function (callback) {
        var command = new Command(this.device, 104, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, [
                data.readUInt16LE(0),
                data.readUInt16LE(2),
                data.readUInt16LE(4),
                data.readUInt16LE(6),
                data.readUInt16LE(8),
                data.readUInt16LE(10),
                data.readUInt16LE(12),
                data.readUInt16LE(14)
            ]);
        });
    };

    Protocol.prototype.rc = function (callback) {
        var command = new Command(this.device, 105, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                roll    : data.readUInt16LE(0),
                pitch   : data.readUInt16LE(2),
                yaw     : data.readUInt16LE(4),
                throttle: data.readUInt16LE(6),
                aux1    : data.readUInt16LE(8),
                aux2    : data.readUInt16LE(10),
                aux3    : data.readUInt16LE(12),
                aux4    : data.readUInt16LE(14)
            });
        });
    };

    Protocol.prototype.rawGPS = function (callback) {
        var command = new Command(this.device, 106, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                fix         : data.readUInt8(0),
                numSat      : data.readUInt8(1),
                coord       : {
                    latitude : data.readUInt32LE(2),
                    longitude: data.readUInt32LE(6),
                    altitude : data.readUInt16LE(10)
                },
                speed       : data.readUInt16LE(12),
                groundCourse: data.readUInt16LE(14)
            });
        });
    };

    Protocol.prototype.compGPS = function (callback) {
        var command = new Command(this.device, 107, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                distanceToHome : data.readUInt16LE(0),
                directionToHome: data.readUInt16LE(2),
                update         : data.readUInt8(4)
            });
        });
    };

    Protocol.prototype.attitude = function (callback) {
        var command = new Command(this.device, 108, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                x      : data.readInt16LE(0),
                y      : data.readInt16LE(2),
                heading: data.readInt16LE(4)
            });
        });
    };

    Protocol.prototype.altitude = function (callback) {
        var command = new Command(this.device, 109, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                estimated: data.readInt32LE(0),
                vario    : data.readInt16LE(4)
            });
        });
    };

    Protocol.prototype.analog = function (callback) {
        var command = new Command(this.device, 110, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                vbat            : data.readUInt8(0),
                intPowerMeterSum: data.readUInt16LE(1),
                rssi            : data.readUInt16LE(3),
                amperage        : data.readUInt16LE(5)
            });
        });
    };

    Protocol.prototype.rcTuning = function (callback) {
        var command = new Command(this.device, 111, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                rcRate        : data.readUInt8(0),
                rcExpo        : data.readUInt8(1),
                rollPitchRate : data.readUInt8(2),
                yawRate       : data.readUInt8(3),
                dynThrottlePID: data.readUInt8(4),
                throttleMID   : data.readUInt8(5),
                throttleExpo  : data.readUInt8(6)
            });
        });
    };

    Protocol.prototype.pid = function (callback) {
        var command = new Command(this.device, 112, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                roll : {
                    p: data.readUInt8(0),
                    i: data.readUInt8(1),
                    d: data.readUInt8(2)
                },
                pitch: {
                    p: data.readUInt8(3),
                    i: data.readUInt8(4),
                    d: data.readUInt8(5)
                },
                yaw  : {
                    p: data.readUInt8(6),
                    i: data.readUInt8(7),
                    d: data.readUInt8(8)
                },
                alt  : {
                    p: data.readUInt8(9),
                    i: data.readUInt8(10),
                    d: data.readUInt8(11)
                },
                pos  : {
                    p: data.readUInt8(12),
                    i: data.readUInt8(13),
                    d: data.readUInt8(14)
                },
                posr : {
                    p: data.readUInt8(15),
                    i: data.readUInt8(16),
                    d: data.readUInt8(17)
                },
                navr : {
                    p: data.readUInt8(18),
                    i: data.readUInt8(19),
                    d: data.readUInt8(20)
                },
                level: {
                    p: data.readUInt8(21),
                    i: data.readUInt8(22),
                    d: data.readUInt8(23)
                },
                mag  : {
                    p: data.readUInt8(24),
                    i: data.readUInt8(25),
                    d: data.readUInt8(26)
                },
                vel  : {
                    p: data.readUInt8(27),
                    i: data.readUInt8(28),
                    d: data.readUInt8(29)
                }
            });
        });
    };

    Protocol.prototype.box = function (callback) {
        var command = new Command(this.device, 113, 0);
        command.send(function (error, data) {
            var i, box;

            if (error) {
                callback(error);
                return;
            }

            box = [];
            for (i = 0; i < data.length; i = i + 2) {
                box[box.length] = data.readUInt16LE(i);
            }

            callback(null, box);
        });
    };

    Protocol.prototype.misc = function (callback) {
        var command = new Command(this.device, 114, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                intPowerTrigger: data.readUInt16LE(0),
                conf           : {
                    minThrottle     : data.readUInt16LE(2),
                    maxThrottle     : data.readUInt16LE(4),
                    minCommand      : data.readUInt16LE(6),
                    failSafeThrottle: data.readUInt16LE(8),
                    magDeclination  : data.readUInt16LE(16),
                    vbat            : {
                        scale: data.readUInt8(18),
                        level: {
                            warn1: data.readUInt8(19),
                            warn2: data.readUInt8(20),
                            crit : data.readUInt8(21)
                        }
                    }
                },
                plog           : {
                    arm     : data.readUInt16LE(10),
                    lifetime: data.readUInt32LE(12)
                }
            });
        });
    };

    Protocol.prototype.motorPins = function (callback) {
        var command = new Command(this.device, 115, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, [
                data.readUInt8(0),
                data.readUInt8(1),
                data.readUInt8(2),
                data.readUInt8(3),
                data.readUInt8(4),
                data.readUInt8(5),
                data.readUInt8(6),
                data.readUInt8(7)
            ]);
        });
    };

    Protocol.prototype.boxNames = function (callback) {
        var command = new Command(this.device, 116, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, data.toString().split(';').filter(function (value) {
                return value !== '';
            }));
        });
    };

    Protocol.prototype.pidNames = function (callback) {
        var command = new Command(this.device, 117, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, data.toString().split(';').filter(function (value) {
                return value !== '';
            }));
        });
    };

    Protocol.prototype.wp = function (callback) {
        var command = new Command(this.device, 118, 0);
        command.send(function (error, data) {
            if (error) {
                callback(error);
                return;
            }

            callback(null, {
                wpNo      : data.readUInt8(0),
                latitude  : data.readUInt32LE(1),
                longitude : data.readUInt32LE(5),
                altHold   : data.readUInt32LE(9),
                heading   : data.readUInt16LE(11),
                timeToStay: data.readUInt16LE(13),
                navFlag   : data.readUInt8(15)
            });
        });
    };

    Protocol.prototype.boxIDs = function (callback) {
        var command = new Command(this.device, 119, 0);
        command.send(function (error, data) {
            var i, boxIDs;

            if (error) {
                callback(error);
                return;
            }

            boxIDs = [];
            for (i = 0; i < data.length; i = i + 1) {
                boxIDs[boxIDs.length] = data.readInt8(i);
            }

            callback(null, boxIDs);
        });
    };

    Protocol.prototype.servoConf = function (callback) {
        var command = new Command(this.device, 120, 0);
        command.send(function (error, data) {
            var i, servoConf;

            if (error) {
                callback(error);
                return;
            }

            servoConf = [];
            for (i = 0; i < 8; i = i + 1) {
                servoConf[servoConf.length] = {
                    min   : data.readUInt16LE(i * 7),
                    max   : data.readUInt16LE(i * 7 + 2),
                    middle: data.readUInt16LE(i * 7 + 4),
                    rate  : data.readUInt8(i * 7 + 6)
                };
            }

            callback(null, servoConf);
        });
    };

    Protocol.prototype.setRawRC = function (roll, pitch, yaw, throtle, aux1, aux2, aux3, aux4, callback) {
        var command = new Command(this.device, 200, 32);

        command.buffer.writeUInt16LE(roll, 5);
        command.buffer.writeUInt16LE(pitch, 7);
        command.buffer.writeUInt16LE(yaw, 9);
        command.buffer.writeUInt16LE(throtle, 11);
        command.buffer.writeUInt16LE(aux1, 13);
        command.buffer.writeUInt16LE(aux2, 15);
        command.buffer.writeUInt16LE(aux3, 17);
        command.buffer.writeUInt16LE(aux4, 19);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.setRawGPS = function (fix, numSat, latitude, longitude, altitude, speed, callback) {
        var command = new Command(this.device, 201, 14);

        command.buffer.writeUInt8(5, fix);
        command.buffer.writeUInt8(6, numSat);
        command.buffer.writeUInt32LE(7, latitude);
        command.buffer.writeUInt32LE(11, longitude);
        command.buffer.writeUInt16LE(15, altitude);
        command.buffer.writeUInt16LE(17, speed);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.setPID = function (roll, pitch, yaw, alt, pos, posr, navr, level, mag, vel, callback) {
        var command = new Command(this.device, 202, 14);

        command.buffer.writeUInt8(5, roll.p);
        command.buffer.writeUInt8(6, roll.i);
        command.buffer.writeUInt8(7, roll.d);

        command.buffer.writeUInt8(8, pitch.p);
        command.buffer.writeUInt8(9, pitch.i);
        command.buffer.writeUInt8(10, pitch.d);

        command.buffer.writeUInt8(11, yaw.p);
        command.buffer.writeUInt8(12, yaw.i);
        command.buffer.writeUInt8(13, yaw.d);

        command.buffer.writeUInt8(14, alt.p);
        command.buffer.writeUInt8(15, alt.i);
        command.buffer.writeUInt8(16, alt.d);

        command.buffer.writeUInt8(17, pos.p);
        command.buffer.writeUInt8(18, pos.i);
        command.buffer.writeUInt8(19, pos.d);

        command.buffer.writeUInt8(20, posr.p);
        command.buffer.writeUInt8(21, posr.i);
        command.buffer.writeUInt8(22, posr.d);

        command.buffer.writeUInt8(23, navr.p);
        command.buffer.writeUInt8(24, navr.i);
        command.buffer.writeUInt8(25, navr.d);

        command.buffer.writeUInt8(26, level.p);
        command.buffer.writeUInt8(27, level.i);
        command.buffer.writeUInt8(28, level.d);

        command.buffer.writeUInt8(29, mag.p);
        command.buffer.writeUInt8(30, mag.i);
        command.buffer.writeUInt8(31, mag.d);

        command.buffer.writeUInt8(32, vel.p);
        command.buffer.writeUInt8(33, vel.i);
        command.buffer.writeUInt8(34, vel.d);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.setBox = function (box, callback) {
        var i, command;

        command = new Command(this.device, 201, box.length * 2);

        for (i = 0; i < box.length; i = i + 1) {
            command.buffer.writeUInt16LE(box[i]);
        }

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.setRCTuning = function (rcRate, rcExpo, rollPitchRate, yawRate, dynThrottlePID, throttleMID, throttleExpo, callback) {
        var command = new Command(this.device, 204, 7);

        command.buffer.writeUInt8(rcRate);
        command.buffer.writeUInt8(rcExpo);
        command.buffer.writeUInt8(rollPitchRate);
        command.buffer.writeUInt8(yawRate);
        command.buffer.writeUInt8(dynThrottlePID);
        command.buffer.writeUInt8(throttleMID);
        command.buffer.writeUInt8(throttleExpo);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.accCalibration = function (callback) {
        var command = new Command(this.device, 205, 0);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.magCalibration = function (callback) {
        var command = new Command(this.device, 206, 0);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.setMisc = function (intPowerTrigger, minThrottle, maxThrottle, minCommand, failSafeThrottle, magDeclination, vbatScale, vbatLevelWarn1, vbatLevelWarn2, vbatLevelCrit, arm, lifetime, callback) {
        var command = new Command(this.device, 207, 22);

        command.buffer.writeUInt16LE(intPowerTrigger, 0);
        command.buffer.writeUInt16LE(minThrottle, 2);
        command.buffer.writeUInt16LE(maxThrottle, 4);
        command.buffer.writeUInt16LE(minCommand, 6);
        command.buffer.writeUInt16LE(failSafeThrottle, 8);
        command.buffer.writeUInt16LE(arm, 10);
        command.buffer.writeUInt32LE(lifetime, 12);
        command.buffer.writeUInt16LE(magDeclination, 16);
        command.buffer.writeUInt8(vbatScale, 18);
        command.buffer.writeUInt8(vbatLevelWarn1, 19);
        command.buffer.writeUInt8(vbatLevelWarn2, 20);
        command.buffer.writeUInt8(vbatLevelCrit, 21);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.resetConf = function (callback) {
        var command = new Command(this.device, 208, 0);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.setWp = function (wpNo, latitude, longitude, altHold, heading, timeToStay, navFlag, callback) {
        var command = new Command(this.device, 209, 18);

        command.buffer.writeUInt8(wpNo, 5);
        command.buffer.writeUInt32LE(latitude, 6);
        command.buffer.writeUInt32LE(longitude, 10);
        command.buffer.writeUInt32LE(altHold, 14);
        command.buffer.writeUInt16LE(heading, 18);
        command.buffer.writeUInt16LE(timeToStay, 20);
        command.buffer.writeUInt8(navFlag, 22);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.selectSetting = function (currentSet, callback) {
        var command = new Command(this.device, 210, 1);

        command.buffer.writeUInt8(currentSet);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.setHead = function (head, callback) {
        var command = new Command(this.device, 211, 2);

        command.buffer.writeInt16LE(head);

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.setServoConf = function (servo1, servo2, servo3, servo4, servo5, servo6, servo7, servo8, callback) {
        var i, servo, command;

        command = new Command(this.device, 212, 56);
        servo = [
            servo1, servo2, servo3, servo4, servo5, servo6, servo7, servo8
        ];

        for (i = 0; i < 8; i = i + 1) {
            command.buffer.writeUInt16LE(servo[i].min, i * 7);
            command.buffer.writeUInt16LE(servo[i].max, i * 7 + 2);
            command.buffer.writeUInt16LE(servo[i].middle, i * 7 + 4);
            command.buffer.writeUInt8(servo[i].rate, i * 7 + 6);
        }

        command.send(function (error) {
            if (error) {
                callback(error);
                return;
            }

            callback(null);
        });
    };

    Protocol.prototype.close = function () {
        if (this.serial.isOpen()) {
            this.serial.close();
        }
    };

    //var protocol = new Protocol('/dev/ttyAMA0');
    //
    //protocol.serialPort().on('open', function () {
    //    protocol.ident(function (error, data) {
    //        console.log("ident", error, data);
    //    });
    //    protocol.status(function (error, data) {
    //        console.log("status", error, data);
    //    });
    //    protocol.rawImu(function (error, data) {
    //        console.log("rawImu", error, data);
    //    });
    //    protocol.servo(function (error, data) {
    //        console.log("servo", error, data);
    //    });
    //    protocol.motor(function (error, data) {
    //        console.log("motor", error, data);
    //    });
    //    protocol.rc(function (error, data) {
    //        console.log("rc", error, data);
    //    });
    //    protocol.rawGPS(function (error, data) {
    //        console.log("rawGPS", error, data);
    //    });
    //    protocol.compGPS(function (error, data) {
    //        console.log("compGPS", error, data);
    //    });
    //    protocol.attitude(function (error, data) {
    //        console.log("attitude", error, data);
    //    });
    //    protocol.altitude(function (error, data) {
    //        console.log("altitude", error, data);
    //    });
    //    protocol.analog(function (error, data) {
    //        console.log("analog", error, data);
    //    });
    //    protocol.rcTuning(function (error, data) {
    //        console.log("rcTuning", error, data);
    //    });
    //    protocol.pid(function (error, data) {
    //        console.log("pid", error, data);
    //    });
    //    protocol.box(function (error, data) {
    //        console.log("box", error, data);
    //    });
    //    protocol.misc(function (error, data) {
    //        console.log("misc", error, data);
    //    });
    //    protocol.motorPins(function (error, data) {
    //        console.log("motorPins", error, data);
    //    });
    //    protocol.boxNames(function (error, data) {
    //        console.log("boxNames", error, data);
    //    });
    //    protocol.pidNames(function (error, data) {
    //        console.log("pidNames", error, data);
    //    });
    //    protocol.wp(function (error, data) {
    //        console.log("wp", error, data);
    //    });
    //    protocol.boxIDs(function (error, data) {
    //        console.log("boxIDs", error, data);
    //    });
    //    protocol.servoConf(function (error, data) {
    //        console.log("servoConf", error, data);
    //    });
    //});

    mwsSelf.Protocol = Protocol;
}

module.exports = new MultiWiiSerialProtocol();