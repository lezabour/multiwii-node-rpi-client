var SerialPort = require('serialport').SerialPort;
var net = require('net');
var config = require('./config');

function SerialOverTcpFactory() {
    "use strict";

    /**
     *
     * Protocol format
     * 0           - $
     * 1           - M
     * 2           - <!>
     * 3           - payload length
     * 4           - code
     * 5-length    - payload
     * 5+length+1  - crc
     *
     * @constructor
     */
    function MultiWiiProtocol() {
        this._data = [];
    }

    /**
     * Receive data from buffer
     *
     * @param {Buffer} data
     * @return {Buffer}
     */
    MultiWiiProtocol.prototype.unserialize = function (data) {
        var i, length, code, crc, offset, valid;

        for (i = 0; i < data.length; i = i + 1) {
            this._data[this._data.length] = data.readUInt8(i);
        }

        valid = false;
        offset = 0;
        while (offset < this._data.length) {
            if (this._data[offset] !== 36) {
                offset = offset + 1;
            } else if (this._data[offset + 1] !== 77) {
                offset = offset + 2;
            } else if (this._data[offset + 2] !== 62) {
                offset = offset + 3;
            } else if (this._data[offset + 3] <= this._data.length - 6 - offset) {
                length = this._data[offset + 3];
                code = this._data[offset + 4];
                crc = 0x00 ^ length ^ code;

                for (i = 0; i < length; i = i + 1) {
                    crc ^= this._data[offset + 5 + i];
                }

                if (crc !== this._data[offset + 5 + length]) {
                    offset = offset + 5 + length;
                } else {
                    data = new Buffer(length);
                    for (i = 0; i < length; i = i + 1) {
                        data.writeUInt8(this._data[offset + 5 + i], i);
                    }

                    valid = true;
                    offset = offset + 5 + length + 1;
                }
            } else {
                break;
            }
        }

        this._data = this._data.slice(offset);

        if (valid) {
            return {
                valid : true,
                length: length,
                code  : code,
                data  : data
            };
        }

        return {
            valid: false
        };
    };

    /**
     *
     * @param {int}         code   - command code
     * @param {Buffer|null} [data] - payload
     * @return {Buffer}
     */
    MultiWiiProtocol.prototype.serialize = function (code, data) {
        var i, length, crc, buffer;

        length = data === undefined || data === null ? 0 : data.length;

        buffer = new Buffer(6 + length);
        buffer.write('$M<');
        buffer.writeUInt8(length, 3);
        buffer.writeUInt8(code, 4);

        crc = 0x00 ^ length ^ code;
        for (i = 0; i < length; i = i + 1) {
            crc ^= data.readUInt8(i);
            buffer.writeUInt8(data.readUInt8(i), i + 5);
        }
        buffer.writeUInt8(crc, buffer.length - 1);

        return buffer;
    };

    /**
     *
     * Protocol format
     * 0           - $
     * 1           - M
     * 2           - <!>
     * 3           - payload length
     * 4           - id
     * 5           - code
     * 6-length    - payload
     * 7+length+1  - crc
     *
     * @constructor
     */
    function TcpProtocol() {
        this._data = [];
    }

    /**
     *
     * @param {Buffer} data - payload
     * @returns {*}
     */
    TcpProtocol.prototype.unserialize = function (data) {
        var i, length, id, code, crc, offset, valid, error;

        for (i = 0; i < data.length; i = i + 1) {
            this._data[this._data.length] = data.readUInt8(i);
        }

        valid = false;
        offset = 0;
        while (offset < this._data.length) {
            if (this._data[offset] !== 36) {
                offset = offset + 1;
                error = 'No beginning "$" char';
            } else if (this._data[offset + 1] !== 77) {
                offset = offset + 2;
                error = 'No beginning "M" char';
            } else if (this._data[offset + 2] !== 60) {
                offset = offset + 3;
                error = 'No beginning "<" char';
            } else if (this._data[offset + 3] <= this._data.length - 6 - offset) {
                length = this._data[offset + 3];
                id = this._data[offset + 4];
                code = this._data[offset + 5];
                crc = 0x00 ^ length ^ code;

                for (i = 0; i < length; i = i + 1) {
                    crc ^= this._data[offset + 6 + i];
                }

                if (crc !== this._data[offset + 6 + length]) {
                    offset = offset + 6 + length;
                    error = 'CRC error';
                    break;
                }

                data = new Buffer(length);
                for (i = 0; i < length; i = i + 1) {
                    data.writeUInt8(this._data[offset + 6 + i], i);
                }

                valid = true;
                offset = offset + 6 + length + 1;
            } else {
                error = 'Data length is less then payload length';
                break;
            }
        }

        this._data = this._data.slice(offset);

        if (valid) {
            return {
                valid : true,
                length: length,
                id    : id,
                code  : code,
                data  : data
            };
        }

        return {
            valid: false,
            error: error
        };
    };

    /**
     *
     * @param {int}         id     - package identifier
     * @param {int}         code   - command code
     * @param {Buffer|null} [data] - payload
     * @returns {Buffer}
     */
    TcpProtocol.prototype.serialize = function (id, code, data) {
        var i, length, crc, buffer;

        length = data === undefined || data === null ? 0 : data.length;

        buffer = new Buffer(7 + length);
        buffer.write('$M>');
        buffer.writeUInt8(length, 3);
        buffer.writeUInt8(id, 4);
        buffer.writeUInt8(code, 5);

        crc = 0x00 ^ length ^ code;
        for (i = 0; i < length; i = i + 1) {
            crc ^= data.readUInt8(i);
            buffer.writeUInt8(data.readUInt8(i), i + 6);
        }
        buffer.writeUInt8(crc, buffer.length - 1);

        return buffer;
    };


    /**
     *
     * @param {string} host
     * @param {int} port
     * @param {Serial} serial
     * @constructor
     */
    function SerialOverTcp(host, port, serial) {
        var tcp, sp, tcpProtocol, spProtocol,
            queue, current, processing, processQueue, processTimeout;

        processQueue = function () {
            current = queue.shift();
            if (!current) {
                processing = false;
                return;
            }
            sp.write(spProtocol.serialize(current.code, current.data));

            processTimeout = setTimeout(function () {
                processQueue();
            }, 1000);
        };

        tcp = new net.Socket();
        tcpProtocol = new TcpProtocol();

        sp = new SerialPort(serial, {
            baudRate: 115200
        });
        spProtocol = new MultiWiiProtocol();

        queue = [];

        tcp.on('close', function () {
            console.log('Reconnecting...');
            tcp.connect(port, host, function () {
                console.log('Reconnected');
            });
        });

        tcp.on('error', function (error) {
            console.log('Error: ' + error);
        });

        console.log('Connecting...');
        tcp.connect(port, host, function () {
            sp.on('data', function (data) {
                var result;
//                console.log('SP: Received ', data);
                result = spProtocol.unserialize(data);
                if (result.valid) {
                    clearTimeout(processTimeout);
                    tcp.write(tcpProtocol.serialize(current.id, result.code, result.data));
                    processQueue();
                }
            });
            console.log('TCP: Connected');
        });

        sp.on('open', function () {
            tcp.on('data', function (data) {
                var result;
//                console.log('TCP: Received ', data);
                result = tcpProtocol.unserialize(data);
                if (result.valid) {
                    queue.push({
                                   id  : result.id,
                                   code: result.code,
                                   data: result.data
                               });
                    if (!processing) {
                        processing = true;
                        processQueue();
                    }
                }
            });
            console.log('SP: Connected');
        });
    }

    this.SerialOverTcp = SerialOverTcp;
}

module.exports = new SerialOverTcpFactory();