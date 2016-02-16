"use strict";
// WM918 weather station
var serial = require("serialport").SerialPort
var serialPort;

// startup function
function startup() {
    serialPort = new serial(fw.settings.serialport, {
        baudrate: parseInt(fw.settings.serialbaud),
        databits: parseInt(fw.settings.serialdatabits),
        stopbits: parseInt(fw.settings.serialstopbits),
        parity: fw.settings.serialparity
        }, true, function(result) {
            if (result !== undefined) {
                return "Serial port open error: " + result
            }
    });

    serialPort.on("open", function () {
        fw.log("Serial port open on " + fw.settings.serialport);
    });
    serialPort.on("data", recvData)
    serialPort.on("error", function (err) {
        fw.log("General serial port error: " + err);
    });

    return "OK"                                 // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

// GLOBALS FOR WEATHER PLUGIN
var rainRate = 0;
var raining = false;
var rainTotal = -1;         // -1 used to initialize for first pass
var wind = false;
var gustDir = "";
var avgDir = "";
var oldData = 0;
var indoorHumidity = -99, outdoorHumidity = -99, indoorTemp = -99, outdoorTemp = -99, pressure = -99, pressTrend = "", prediction = "", newRain = -99, gustSpeed = -99, windDir = ""
var avgSpeed, avgWindRad, chillOutdoorCurrent = -99, dewPtIndoorCurrent = -99, dewPtOutdoorCurrent = -99, rainTotalDay = 0;

function recvData(data) {
    switch (data[0]) {
         case 0x8F:                 // Humidity
            if (chksum(data, 34)) {
                oldData = indoorHumidity
                indoorHumidity = 10 * (data[8] >>> 4) + (data[8] & 0x0F)            //8F. 8	DD	all	Humid	Indoor:    10<ab<97 % @ 1
                if (indoorHumidity > oldData) fw.toHost("Indoor Humidity", "increasing", indoorHumidity)
                if (indoorHumidity < oldData) fw.toHost("Indoor Humidity", "decreasing", indoorHumidity)
                
                oldData = outdoorHumidity
                outdoorHumidity = 10 * (data[20] >>> 4) + (data[20] & 0x0F)         //8F.20	DD	all	Humid	Outdoor:    10<ab<97 % @ 1
                if (outdoorHumidity > oldData) fw.toHost("Outdoor Humidity", "increasing", outdoorHumidity)
                if (outdoorHumidity < oldData) fw.toHost("Outdoor Humidity", "decreasing", outdoorHumidity)
                fw.log("Indoor Humidity: " + indoorHumidity + ", outdoor: " + outdoorHumidity)
            }
            break;

         case 0x9F:          // Temperature Lo/Hi
            if (chksum(data, 33)) {
                //9F. 1	DD	all	Temp	Indoor: 'bc' of 0<ab.c<50 degrees C @ 0.1
                //9F. 2	xB	0-2	Temp	Indoor: 'a' of <ab.c> C
                oldData = indoorTemp
                indoorTemp = (data[2] & 0x07) * 10 + (data[1] >>> 4) + (data[1] & 0x0F) / 10;
                if (indoorTemp > oldData) fw.toHost("Indoor Temperature", "increasing", indoorTemp)
                if (indoorTemp < oldData) fw.toHost("Indoor Temperature", "decreasing", indoorTemp)
                
                //9F.16	DD	all	Temp	Outdoor: 'bc' of -40<ab.c<60 degrees C @ 0.1
                //9F.17	xB	0-2	Temp	Outdoor: 'a' of <ab.c> C
                //9F.17	xB	3	Temp	Outdoor: Sign 0=+, 1=-
                oldData = outdoorTemp
                outdoorTemp = (data[17] & 0x07) * 10 + (data[16] >>> 4) + (data[16] & 0x0F) / 10;
                if ((data[17] & 0x08) !== 0) outdoorTemp = outdoorTemp * -1 
                if (outdoorTemp > oldData) fw.toHost("Outdoor Temperature", "increasing", outdoorTemp)
                if (outdoorTemp < oldData) fw.toHost("Outdoor Temperature", "decreasing", outdoorTemp)
                fw.log("Indoor Temp: " + indoorTemp + ", outdoor: " + outdoorTemp)
            }
            break;

         case 0xAF:                      // Barometer / DewPt Lo/Hi
            if (chksum(data, 30)) {
                //AF. 1	DD	all	Barom	Local: 'cd' of 795<abcd<1050 mb @ 1
                //AF. 2	DD	all	Barom	Local: 'ab' of <abcd> mb
                oldData = pressure
                pressure = 1000 * (data[2] >>> 4) + 100 * (data[2] & 0x0F) + 10 * (data[1] >>> 4) + (data[1] & 0x0F)
                if (pressure > oldData) fw.toHost("Barometric Pressure", "increasing", pressure)
                if (pressure < oldData) fw.toHost("Barometric Pressure", "decreasing", pressure)
                
                //AF. 6	Bx	0-2	Barom	Trend: 1=Raising, 2=Steady, 4=Falling
                //AF. 6	Bx	3
                //AF. 6	xB	all	Barom	Prediction: 1=Sunny, 2=Cloudy, 4=Partly, 8=Rain
                oldData = pressTrend
                if ((data[6] >>> 4) === 1) pressTrend = "Rising"
                if ((data[6] >>> 4) === 2) pressTrend = "Steady"
                if ((data[6] >>> 4) === 4) pressTrend = "Falling"
                if (oldData !== pressTrend) fw.toHost("Pressure Trend", "text", pressTrend)
                oldData = prediction
                if ((data[6] & 0x01) === 0x01) prediction = "Sunny"
                if ((data[6] & 0x02) === 0x02) prediction = "Cloudy"
                if ((data[6] & 0x04) === 0x04) prediction = "Partly Cloudy"
                if ((data[6] & 0x08) === 0x08) prediction = "Rain"
                if (oldData !== prediction) fw.toHost("Prediction", "text", prediction)
                fw.log("Barometer Pressure: " + pressure + ", Trend: " + pressTrend + ", Prediction: " + prediction)

                //AF. 7	DD	all	Dewpt	Indoor:    0<ab<47 degrees C @ 1
                oldData = dewPtIndoorCurrent
                dewPtIndoorCurrent = 10 * (data[7] >>> 4) + (data[7] & 0x0F)
                if (dewPtIndoorCurrent > oldData) fw.toHost("Indoor Dew Point", "increasing", dewPtIndoorCurrent)
                if (dewPtIndoorCurrent < oldData) fw.toHost("Indoor Dew Point", "decreasing", dewPtIndoorCurrent)
                
                //AF.18	DD	all	Dewpt	Outdoor:    0<ab<56 degrees C @ 1
                oldData = dewPtOutdoorCurrent
                dewPtOutdoorCurrent = 10 * (data[18] >>> 4) + (data[18] & 0x0F)
                if (dewPtOutdoorCurrent > oldData) fw.toHost("Outdoor Dew Point", "increasing", dewPtOutdoorCurrent)
                if (dewPtOutdoorCurrent < oldData) fw.toHost("Outdoor Dew Point", "decreasing", dewPtOutdoorCurrent)
            }
            break;

         case 0xBF:                   // Rain Lo/Hi
            if (chksum(data, 13)) {
                //BF. 1	DD	all	Rain	Rate: 'bc' of 0<abc<998 mm/hr @ 1
                //BF. 2	xD	all	Rain	Rate: 'a' of <abc> mm/hr
                oldData = rainRate
                rainRate = 100 * (data[2] & 0x0F) + 10 * (data[1] >>> 4) + (data[1] & 0x0F)
                if (rainRate > oldData) fw.toHost("Rain Rate", "increasing", getValue)
                if (rainRate < oldData) fw.toHost("Rain Rate", "decreasing", getValue)
                if (raining === false && rainRate > 0) {
                    fw.toHost("Raining", "started", 1)
                    raining = true
                }
                if (raining === true && rainRate === 0) {
                    fw.toHost("Raining", "finished", 0)
                    raining = false
                }

                //BF. 5	DD	all	Rain	Total: 'cd' of <abcd> mm
                //BF. 6	DD	all	Rain	Total: 'ab' of <abcd> mm
                newRain = 1000 * (data[6] >>> 4) + 100 * (data[6] & 0x0F) + 10 * (data[5] >>> 4) + (data[5] & 0x0F)
                // Track the delta rain not the absolute rainfall (which the MW-918 does) because we can't control when the totals get reset
                if (rainTotal === -1) rainTotal = newRain                           // RainTotal is intialised at startup as -1 so first read of serial port will set it to the WM918 rain total read
                if (newRain === 0) rainTotal = 0                                    // Reset our tracking counter if the WM-918 is also reset
                if (newRain > rainTotal) {                                          // Check to see if we have more rain since we last checked 5 seconds ago
                    rainTotalDay = rainTotalDay + newRain - rainTotal               // Add up delta of new rain
                    rainTotal = newRain                                             // Reset total to current rain total
                    fw.toHost("Daily Rain", "mm", rainTotal)
                }
            }
            break;

         case 0xCF:                   // Wind Lo/Hi
            if (chksum(data, 26)) {
                //CF. 1	DD	all	Wind	Gust Speed: 'bc' of 0<ab.c<56 m/s @ 0.2
                //CF. 2	Dx	all	Wind	Gust Dir:   'c' of 0<abc<359 degrees @ 1
                //CF. 2	xD	all	Wind	Gust Speed: 'a' of <ab.c> m/s
                oldData = gustSpeed
                gustSpeed = ((data[2] & 0x07) * 10 + (data[1] >>> 4) + (data[1] & 0x0F) / 10) * 3.6    // Convert m/s to km/hr as default is m/s
                if (gustSpeed > oldData) fw.toHost("Wind Speed", "increasing", gustSpeed)
                if (gustSpeed < oldData) fw.toHost("Wind Speed", "decreasing", gustSpeed)
                if (gustSpeed > 0 && wind === false) {
                    wind = false 
                    fw.toHost("Windy", "started", 1)
                }
                if (gustSpeed === 0 && wind === true) {
                    wind = false 
                    fw.toHost("Windy", "finished", 0)
                }

                //CF. 3	DD	all	Wind	Gust Dir:   'ab' of <abc>
                oldData = gustDir
                windDir = 100 * (data[3] >>> 4) + 10 * (data[3] & 0x0F) + (data[2] >>> 4)
                if (windDir > 337 || windDir <= 22) gustDir = "East"                            // Polar coordinates
                if (windDir > 22 && windDir <= 67) gustDir = "NorthEast"
                if (windDir > 67 && windDir <= 112) gustDir = "North"
                if (windDir > 112 && windDir <= 157) gustDir = "NorthWest"
                if (windDir > 157 && windDir <= 202) gustDir = "West"
                if (windDir > 202 && windDir <= 247) gustDir = "SouthWest"
                if (windDir > 247 && windDir <= 292) gustDir = "South"
                if (windDir > 292 && windDir <= 337) gustDir = "SouthEast"
                if (gustDir !== oldData) fw.toHost("Wind Direction", "", windDir)

                //CF. 4	DD	all	Wind	Avg Speed:  'bc' of 0<ab.c<56 m/s @ 0.1
                //CF. 5	Dx	all	Wind	Avg Dir:    'c' of <abc>
                //CF. 5	xD	all	Wind	Avg Speed:  'a' of <ab.c> m/s
                // AVGSPEED DOES NOT WORK, ONLY GET 0 EVEN IF WINDY
                oldData = avgSpeed
                avgSpeed = ((data[5] & 0x07) * 10 + (data[4] >>> 4) + (data[4] & 0x0F) / 10) * 3.6    // Convert m/s to km/hr as default is m/s
                if (avgSpeed > oldData) fw.toHost("Average Wind Speed", "increasing", avgSpeed)
                if (avgSpeed < oldData) fw.toHost("Average Wind Speed", "decreasing", avgSpeed)


                //CF. 6	DD	all	Wind	Avg Dir:    'ab' of <abc>
                oldData = avgDir
                avgWindRad = 100 * (data[6] >>> 4) + 10 * (data[6] && 0x0F) + (data[5] >>> 4)
                        //WeatherData.Wind.AvgDirRad = WindDir
                if (avgWindRad > 337 || avgWindRad <= 22) avgDir = "East"
                if (avgWindRad > 22 && avgWindRad <= 67) avgDir = "NorthEast"
                if (avgWindRad > 67 && avgWindRad <= 112) avgDir = "North"
                if (avgWindRad > 112 && avgWindRad <= 157) avgDir = "NorthWest"
                if (avgWindRad > 157 && avgWindRad <= 202) avgDir = "West"
                if (avgWindRad > 202 && avgWindRad <= 247) avgDir = "SouthWest"
                if (avgWindRad > 247 && avgWindRad <= 292) avgDir = "South"
                if (avgWindRad > 292 && avgWindRad <= 337) avgDir = "SouthEast"
                if (avgDir !== oldData) fw.toHost("Average Wind Direction", "", avgDir)

                //CF.16	DD	all	Chill	Temp: -85<ab<60 degrees C @ 1
                oldData = chillOutdoorCurrent
                chillOutdoorCurrent = 10 * (data[16] >>> 4) + (data[16] & 0x0F)
                if (chillOutdoorCurrent > oldData) fw.toHost("Outdoor Chill Temperature", "increasing", chillOutdoorCurrent)
                if (chillOutdoorCurrent < oldData) fw.toHost("Outdoor Chill Temperature", "deccreasing", chillOutdoorCurrent)
                fw.log("Wind Gust: " + gustSpeed + "km/hr, Direction: " + gustDir)
            }
            break;
         default:
    }
}

function chksum(buffer, length) {
    var calcChksum = 0;
    if (buffer.length === length + 1) {
        for (var lp = 0; lp < buffer.length - 1; lp++) {    // Array starts from 0, and don't include the checksum itself in the calcs
            calcChksum =  calcChksum + buffer[lp];
        }
        if ((calcChksum & 0xFF) === buffer[length]) {        // Extract just the 8 bits byte & compare to the last byte = chksum
            return true;
        }
    }
    return false;
}

// Receive a message from the host
function fromHost(channel, scope, data) {
    //Insert code to manage messages from the host
}

// Shutdown the plugin
function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    return "OK"
}

// Initialize the plugin -------------- DO NOT MODIFY THIS SECTION
var fw = new Object();
process.on('message', function (msg) {
    var retval;
    switch (msg.func.toLowerCase()) {
        case "init":
            fw.cat = msg.data.cat;
            fw.plugName = msg.data.name;
            fw.channels = msg.data.channels;
            fw.settings = msg.data.settings;
            fw.store = msg.data.store;
            fw.restart = function (code) { process.exit(code) };
            fw.log = function (msg) { process.send({ func: "log", cat: fw.cat, name: fw.plugName, log: msg }); };
            fw.toHost = function (myChannel, myScope, myData, myLog) { process.send({ func: "tohost", cat: fw.cat, name: fw.plugName, channel: myChannel, scope: myScope, data: myData, log: myLog }); };
            fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) { process.send({ func: "addch", cat: fw.cat, name: fw.plugName, channel: name, scope: desc, data: { type: type, io: io, min: min, max: max, units: units, attribs: attribs, value: value, store: store } }); };
            fw.writeIni = function (section, subSection, key, value) { process.send({ func: "writeini", cat: fw.cat, name: fw.plugName, data: { section: section, subSection: subSection, key: key, value: value } }); };
            retval = startup();
            break;
        case "fromhost":
            retval = fromHost(msg.channel, msg.scope, msg.data)
            break;
        case "shutdown":
            retval = shutPlugin(msg.data);
            break;
    }
    process.send({ func: msg.func, cat: fw.cat, name: fw.plugName, data: retval, log: process.execArgv[0] });
});

