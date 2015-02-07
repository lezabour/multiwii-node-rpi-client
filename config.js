var config = {
    // Api key for server
    api   : '',
    tcp   : {
        // Server host address
        host: '10.10.10.1',
        // Server listening port
        port: 3002
    },
    // Serial port
    serial: {
        port    : '/dev/ttyAMA0',
        baudRate: 115200
    }
};

// Don't modify under this line
// -------------------------------

module.exports = config;