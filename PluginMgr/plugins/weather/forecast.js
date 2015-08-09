"use strict";

// Australia Bureau of Meteorology, parse forecast XML for Brisbane
var parseForecast = require("xml2js").parseString;
var ftp = require("ftp-get")
var daysWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var timer, ftpFile, nextFcstDelay;

// startup function
function startup() {
    ftpFile = fw.settings["url"] + "/" + fw.settings["xml"];
    nextFcstDelay = fw.settings["waitifforecastlatesecs"] * 1000        
    return pollForecast()                                 // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
}

var bomForecasts;
var forecast = function(full, precis, precip, chance, min, max, icon) {
    this.full = full;
    this.precis = precis;
    this.precip = precip;
    this.chance = chance;
    this.min = min;
    this.max = max;
    this.icon = icon;
}

function pollForecast() {
    try {
        ftp.get(ftpFile, function (err, result) {
            if (err !== null) {
                fw.log("Error occurred getting FTP weather forecast (" + ftpFile + "). " + err)
                setTimeout(pollForecast, parseInt(fw.settings["errortimeout"]));                             // try again later
            } else {
                parseForecast(result, function (err, jsonFcst) {
                    if (err !== null) {
                        fw.log("Error occurred parsing weather forecast (" + ftpFile + "). " + err)
                        setTimeout(pollForecast, parseInt(fw.settings["errortimeout"]));                             // try again later
                    } else {
                        var readFcsts = [];
                        var xmlFcst = jsonFcst.product.forecast[0].area
                        for (var day = 0; day < forecast.length; day++) {
                            var period = xmlFcst[2]["forecast-period"][day]
                            var summary = "No Summary", min = "N/A", max = "N/A", precis = "No Precis", probability = "N/A", precipRange = "N/A", icon = "";
                            for (var element in period.element) {                                               // parse element tags
                                if (period.element[element].$.type === "forecast_icon_code") icon = period.element[element]._;
                                if (period.element[element].$.type === "precipitation_range") precipRange = period.element[element]._;
                                if (period.element[element].$.type === "air_temperature_minimum") min = period.element[element]._;
                                if (period.element[element].$.type === "air_temperature_maximum") max = period.element[element]._;
                            }
                            for (var text in period.text) {                                                 // parse text tags 
                                if (period.text[text].$.type === "precis") precis = period.text[text]._;
                                if (period.text[text].$.type === "probability_of_precipitation") probability = period.text[text]._;
                            }
                            
                            if (xmlFcst[1]["forecast-period"][day].text[0].$.type === "forecast") summary = xmlFcst[1]["forecast-period"][day].text[0]._
                            var chOffset = 5 * day + (day !== 0) * 2

                            switch (icon) {                         // From http://www.bom.gov.au/info/forecast_icons.shtml
                                case "1":
                                    icon = "Sunny"
                                    break;
                                case "2":
                                    icon = "Clear"
                                    break;
                                case "3":
                                    icon = "Partly Cloudy"
                                    break;
                                case "4":
                                    icon = "Cloudy"
                                    break;
                                case "6":
                                    icon = "Hazy"
                                    break;
                                case "8":
                                    icon = "Light Rain"
                                    break;
                                case "9":
                                    icon = "Windy"
                                    break;
                                case "10":
                                    icon = "Fog"
                                    break;
                                case "11":
                                    icon = "Shower"
                                    break;
                                case "12":
                                    icon = "Rain"
                                    break;
                                case "13":
                                    icon = "Dusty"
                                    break;
                                case "14":
                                    icon = "Frost"
                                    break;
                                case "15":
                                    icon = "Snow"
                                    break;
                                case "16":
                                    icon = "Storm"
                                    break;
                                case "17":
                                    icon = "Light shower"
                                    break;
                                default:
                                    icon = ""
                            }
                            
                            fw.toHost(fw.channels[0 + chOffset].name, fw.channels[0 + chOffset].units, summary, false);
                            fw.toHost(fw.channels[1 + chOffset].name, fw.channels[1 + chOffset].units, precis, false);
                            fw.toHost(fw.channels[2 + chOffset].name, fw.channels[2 + chOffset].units, min, false);
                            fw.toHost(fw.channels[3 + chOffset].name, fw.channels[3 + chOffset].units, max, false);
                            fw.toHost(fw.channels[4 + chOffset].name, fw.channels[4 + chOffset].units, icon, false);
                            if (day === 0) {
                                fw.toHost(fw.channels[5 + chOffset].name, fw.channels[2 + chOffset].units, precipRange, false);
                                fw.toHost(fw.channels[6 + chOffset].name, fw.channels[3 + chOffset].units, probability, false);
                            }
                        }
                    }
                    
                    for (var i = 0; i < 7; i++) {
                        var currDate = new Date()
                        var newDate = new Date(currDate.setDate(currDate.getDate() + i).valueOf())
                        fw.toHost(fw.channels[37 + i].name, fw.channels[37 + i].units, daysWeek[newDate.getDay()], false);     // Publish day names of forecast
                    }
                                                            
                    var UTCNextFcst = new Date(jsonFcst.product.amoc[0]["next-routine-issue-time-utc"][0])// TODO: add a timezone offset as time is Sydney time
                    var nextFcst = (UTCNextFcst - new Date()) + nextFcstDelay              // calculate the number of msec + a small delay to the next forecast
                    if (nextFcst < nextFcstDelay) nextFcst = nextFcstDelay                        // If there is a delay putting up the next forecast, check every few mins
                    setTimeout(pollForecast, nextFcst);                             // schedule timer when the next forecast is ready
                });
            }
        });
        return "OK"
    } catch (err) {
        return err;
    }
}

// Receive a message from the host
exports.fromHost  = function(channel, scope, data) {
    //Insert code to manage messages from the host
}

// Shutdown the plugin
exports.shutPlugin = function shutPlugin(param) {
    //Insert any orderly shutdown code needed here
    return "OK"
}

// Initialize the plugin - DO NOT MODIFY THIS FUNCTION
var fw = new Object();
exports.loaded = function(iniCat, iniName, iniChannels, iniSettings, iniStore) {
    fw.cat = iniCat;
    fw.plugName = iniName;
    fw.channels = iniChannels;
    fw.settings = iniSettings;
    fw.store = iniStore;
    fw.log = function (msg) { module.parent.exports.log(fw.cat + "/" + fw.plugName, msg) };
    fw.toHost = function (myChannel, myScope, myData, myLog) { module.parent.exports.toHost(fw.cat, fw.plugName, myChannel, myScope, myData, myLog) };
    fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) {module.parent.exports.addChannel(fw.cat, fw.plugName, name, desc, type, io, min, max, units, attribs, value, store)};
    return startup();
}
