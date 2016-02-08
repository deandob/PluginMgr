"use strict";
// Name:            IP Cameras.js
// Desc:            Manage IP cameras for live streaming, recording, playback and motion detection.
// Prerequisites:   Cameras need to support RTSP
// Dependencies:    FFMPEG vXX, opencv-node vXX
// Author:
// License:
// Version:
// Created:
// Last Updated:
// Bugs:
// TODO: Check ffmpeg licensing and ensure correct attribution

// Comments:
// Dynamic ramdisk: http://reboot.pro/files/download/284-imdisk-toolkit/
// command line start for ramdisk: imdisk -a -s 15M -m z: -p "/fs:ntfs /q /y" requires admin privs

var http = require( 'http' );
var child_process = require( "child_process" );
var fs = require( 'fs' );
var url = require( "url" );
var request = require( 'request' );
var mime = require( 'mime' );
var eventEmitter = require( "events" ).EventEmitter;
var motionAlarm = new eventEmitter();

var recServer
var liveServer
var vidRoot
var recTimer;
var segmentmSec;
var mdTimeout;

var cameras = []
var camera = function ( name, desc, rtsp, snapshot, masks, status, ffmpeg ) {
    this.name = name;
    this.desc = desc;
    this.rtsp = rtsp;
    this.snapshot = snapshot;
    this.masks = masks;
    this.status = status;
    this.recffmpeg = ffmpeg;
    this.liveffmpeg = null;
    this.motionTimer = null;
    this.motion = false;
    this.liveStarted = false;
    this.maxChange = 0;
    this.normTrigger = 0;
    this.motionStart = null;
    this.alarmTriggeredTimer = 0;
    this.primed = false;
    this.primeTrigTimer = 0;
    this.latestMP4 = new Date(0);
    this.motionTimes = [];
};

// save snapshots from the IP camera to the ramdisk, get as many as we can
function saveSnapShot( cam ) {
    if ( cameras[cam].primed === false ) return
    setTimeout( saveSnapShot, fw.settings.snapshotrate, cam )               // get more snapshots with small delay
    var writeFile = fs.createWriteStream( fw.settings.cachepath + cameras[cam].name + "-" + timeDateStr( new Date ) + ".jpg" )
    var readFile = request( cameras[cam].snapshot ).pipe( writeFile )
}

function startFFMPEG( rtsp, recSeg, camName ) {
    //TODO: Could turn this into a native module & call a FFMPEG DLL 
    var ffmpeg = child_process.spawn( "ffmpeg/ffmpeg", [
        "-rtsp_transport", "tcp", "-i", rtsp, "-vcodec", "copy", "-f", "mp4", "-f", "segment", "-segment_time", recSeg, "-segment_wrap", 2, "-map", "0",
        "-segment_format", "mp4", "-reset_timestamps", "1", "-y", fw.settings.cachepath + camName + "-%01d.mp4"
    ], { detached: false });

    clearTimeout( mdTimeout )
    mdTimeout = setTimeout( checkMotion, parseInt( fw.settings.recordingsegment ) * 1500 ) // initially add an extra delay of 50% to timer intervals are different to segment file change times 

    fw.log( "Starting recording camera " + rtsp )

    ffmpeg.on( "exit", function ( code ) {
        fw.log( "ffmpeg terminated with code " + code + ". Restarting..." );
        startFFMPEG( rtsp, recSeg, camName )
    });

    ffmpeg.on( "error", function ( e ) {
        fw.log( "system error: " + e );
    });

    ffmpeg.stdout.on( "data", function ( data ) {
        //fw.log('data rcv ');
    });

    ffmpeg.stderr.on( "data", function ( data ) {
        //fw.log("FFMPEG -> " + data);
    });

    return ffmpeg
}

// Live video stream management for HTML5 video. Uses FFMPEG to connect to H.264 camera stream, 
// Camera stream is remuxed to a MP4 stream for HTML5 video compatibility and segments are recorded for later playback
var liveStream = function ( req, resp ) {                                            // handle each client request by instantiating a new FFMPEG instance
    // For live streaming, create a fragmented MP4 file with empty moov (no seeking possible).
    
    var reqUrl = url.parse( req.url, true )
    var cameraName = typeof reqUrl.pathname === "string" ? reqUrl.pathname.substring( 1 ) : undefined;
    if ( cameraName ) {
        try {
            cameraName = decodeURIComponent( cameraName );
        } catch ( exception ) {
            fw.log( "Live Camera Streamer bad request received - " + reqUrl );         // Can throw URI malformed exception.
            return false;
        }
    } else {
        fw.log( "Live Camera Streamer - incorrect camera requested " + cameraName );         // Can throw URI malformed exception.
        return false;
    }

    fw.log( "Client connection made to live Camera Streamer requesting camera: " + cameraName )

    resp.writeHead( 200, {
        //'Transfer-Encoding': 'binary'
        "Connection": "keep-alive"
        , "Content-Type": "video/mp4"
    //, 'Content-Length': chunksize            // ends after all bytes delivered
        , "Accept-Ranges": "bytes"                 // Helps Chrome
    });

    for ( var cam in cameras ) {
        if ( cameraName.toLowerCase() === cameras[cam].name.toLowerCase() ) {
            if ( !cameras[cam].liveStarted ) {
                cameras[cam].liveffmpeg = child_process.spawn( "ffmpeg/ffmpeg", [
                    "-rtsp_transport", "tcp", "-i", cameras[cam].rtsp, "-vcodec", "copy", "-f", "mp4", "-movflags", "frag_keyframe+empty_moov",
                    "-reset_timestamps", "1", "-vsync", "1", "-flags", "global_header", "-bsf:v", "dump_extra", "-y", "-"   // output to stdout
                ], { detached: false });

                cameras[cam].liveStarted = true;
                cameras[cam].liveffmpeg.stdout.pipe( resp );

                cameras[cam].liveffmpeg.stdout.on( "data", function ( data ) {
                });

                cameras[cam].liveffmpeg.stderr.on( "data", function ( data ) {
                    //fw.log(cameras[cam].name + " -> " + data);
                });

                cameras[cam].liveffmpeg.on( "exit", function ( e ) {
                    fw.log( cameras[cam].name + " live FFMPEG terminated with code " + e );
                });

                cameras[cam].liveffmpeg.on( "error", function ( e ) {
                    fw.log( cameras[cam].name + " live FFMPEG system error: " + e );
                });
            }
            break;                       // Keep cam variable active with the selected cam number
        }
    }
    if ( cameras[cam].liveStarted === false ) {
        // Didn't select a camera
    }

    req.on( "close", function () {
        shutStream( "closed" )
    })

    req.on( "end", function () {
        shutStream( "ended" )
    });

    function shutStream( event ) {
        //TODO: Stream is only shut when the browser has exited, so switching screens in the client app does not kill the session
        fw.log( "Live streaming connection to client has " + event )
        if ( typeof cameras[cam].liveffmpeg !== "undefined" ) {
            cameras[cam].liveffmpeg.kill();
            cameras[cam].liveStarted = false;
        }
    }
    return true
}

    // Stream mp4 video file based on URL request from client player. Accept request for partial streams
    // Code attribution: https://github.com/meloncholy/vid-streamer/blob/master/index.js (MIT license)
var recStream = function ( req, resp ) {
    // For recording, use a different output stream to segment the files into short durations, which allows for selecting the time segment needed, can delete segments with no motion, and easier to seek within the file.

    var stream;
    var stat;
    var info = {};
    var range = typeof req.headers.range === "string" ? req.headers.range : undefined;
    var reqUrl = url.parse( req.url, true );
    
    info.path = typeof reqUrl.pathname === "string" ? reqUrl.pathname.substring( 1 ) : undefined;
    if ( info.path ) {
        try {
            info.path = decodeURIComponent( info.path );
        } catch ( exception ) {
            fw.log( "Recording Streamer Bad request received - " + resp );         // Can throw URI malformed exception.
            return false;
        }
    }

    info.file = info.path.match( /(.*[\/|\\])?(.+?)$/ )[2];
    info.path = vidRoot + "/" + info.path;

    try {
        stat = fs.statSync( info.path );
        if ( !stat.isFile() ) {
            fw.log( "Recording Streamer bad file specified - " + resp );
            return false;
        }
    } catch ( e ) {
        fw.log( "Recording Streamer bad file specified - " + resp + " " + e );
        return false;
    }

    info.start = 0;
    info.end = stat.size - 1;
    info.size = stat.size;
    info.modified = stat.mtime;
    info.maxAge = "3600"
    info.server = info.file
    info.mime = "video/mp4"

    var code = 206;                                                     // Always use partial HTTP response to ensure chunked GETS so video starts instantaneously and streams
    var header = {
        "Cache-Control": "public; max-age=" + info.maxAge,
        Connection: "keep-alive",
        "Content-Type": info.mime,
        "Content-Disposition": "inline; filename=" + info.file + ";"
    };

    if ( range !== undefined && ( range = range.match( /bytes=(.+)-(.+)?/ ) ) !== null ) {
        // Check range contains numbers and they fit in the file. Make sure info.start & info.end are numbers (not strings) or stream.pipe errors out if start > 0.
        info.start = isNumber( range[1] ) && range[1] >= 0 && range[1] < info.end ? range[1] - 0 : info.start;
        info.end = isNumber( range[2] ) && range[2] > info.start && range[2] <= info.end ? range[2] - 0 : info.end;
        header["Accept-Ranges"] = "bytes";
    } else if ( reqUrl.query.start || reqUrl.query.end ) {
        // This is a range request, but doesn't get range headers.
        info.start = isNumber( reqUrl.query.start ) && reqUrl.query.start >= 0 && reqUrl.query.start < info.end ? reqUrl.query.start - 0 : info.start;
        info.end = isNumber( reqUrl.query.end ) && reqUrl.query.end > info.start && reqUrl.query.end <= info.end ? reqUrl.query.end - 0 : info.end;
    }

    info.length = info.end - info.start + 1;

    header["Content-Range"] = "bytes " + info.start + "-" + info.end + "/" + info.size;
    header.Pragma = "public";
    header["Last-Modified"] = info.modified.toUTCString();
    header["Transfer-Encoding"] = "chunked";
    header["Content-Length"] = info.length;
    header.Server = info.server;

    resp.writeHead( code, header );
    stream = fs.createReadStream( info.path, { flags: "r", start: info.start, end: info.end });
    stream.pipe( resp );

    return true;
};

var isNumber = function ( n ) {
    return !isNaN( parseFloat( n ) ) && isFinite( n );        // http://stackoverflow.com/a/1830844/648802
};

// Process motion based on start/stop times in motionTimes array. MP4 files have segment duration, jpg snapshots are instantaneous, so process files based on type.
// for MP4, ignore files with create date > currtime - segtime (current file being written to). Motion start/stop times may cover both MP4 segment files. 
// Delete oldest MP4 after processing so that the create date is correct for the new file
// for JPGEG, only copy files between start motion and end motion, regardless of time, and delete all the others

// Bugs:
// Sometimes JPEG files are only 1 Kb large and being created close to each other in time (possibly due to prime resetting & seting immediately back
// Not all JPEG files being copied over when motion
// MP4 files not being deleted sometimes
var copyingCnt
function checkMotion() {
    setTimeout( checkMotion, segmentmSec )        // cycle timer for the same duration as the segment time
    var lastWrite
    var latestMP4 = new Date( 0 )
    var fileArray = []
    fs.readdir( fw.settings.cachepath, function ( err, files ) {
        if ( err ) return fw.log( "WARNING: No motion files being captured from camera " + cameras[mycam].name )
            var fileCnt = 0;
            for ( var i = 0; i < files.length; ++i ) { 
                ( function ( i ) {
                    //TODO: Searching for latest MP4 needs to take into account different cameras......
                fs.stat( fw.settings.cachepath + "/" + files[i], function ( err, stat ) {
                    fileCnt = fileCnt + 1
                    if (err) {
                        //fw.log("STAT ERR " + err + " " + files[i])
                        return;
                    }
                    fileArray.push( { file: files[i], ext: files[i].substr( -3, 3 ), ctime: stat.ctime })
                    if ( fileArray[fileArray.length - 1].ext === "mp4" && stat.ctime > latestMP4 ) latestMP4 = stat.ctime;
                    if ( fileCnt === files.length ) {           // got all the directory info async
                        var newFiles = []
                        for ( var mycam in cameras ) {
                            copyingCnt = 0
                            if ( cameras[mycam].motionTimes.length > 0 ) {
                                for ( var file in fileArray ) {                                                             // Loop through all files
                                    var fileSplit = fileArray[file].file.split( "-" )
                                    if ( fileSplit[0] === cameras[mycam].name ) {                                           // Only look at files for specific camera
                                        if ( fileArray[file].ctime < latestMP4 ) {                                          // Only process files from the old segment
                                            for ( var alarm in cameras[mycam].motionTimes ) {                               // Loop through all the alarms
                                                switch ( fileArray[file].ext ) {
                                                    case "jpg":                               // if create time is within motion start/stop times, copy over then delete, else delete
                                                        if ( fileArray[file].ctime > cameras[mycam].motionTimes[alarm].start && fileArray[file].ctime < cameras[mycam].motionTimes[alarm].stop ) {
                                                            var writeStream = fs.createWriteStream( vidRoot + "/" + fileSplit[0] + "/" + fileSplit[1] )
                                                            fs.createReadStream( fw.settings.cachepath + "/" + fileArray[file].file ).pipe( writeStream );  // will fail for files still open but will be picked up next iteration
                                                            newFiles.push( fileArray[file].file )
                                                            copyingCnt = copyingCnt + 1
                                                            writeStream.on( 'finish', function () { copyingCnt = copyingCnt - 1 });
                                                        }
                                                        break;
                                                    case "mp4":
                                                        if ( lastWrite !== fileArray[file].ctime ) {       // Only copy mp4 segment once even if there are multiple triggers within the timeframe
                                                            // if motion has started or ended within the duration of the MP4, then copy it over
                                                            if ( ( cameras[mycam].motionTimes[alarm].start > fileArray[file].ctime && cameras[mycam].motionTimes[alarm].start.valueOf() < (fileArray[file].ctime.valueOf() + segmentmSec ) ) ||
                                                                ( cameras[mycam].motionTimes[alarm].stop > fileArray[file].ctime && cameras[mycam].motionTimes[alarm].stop.valueOf() < ( fileArray[file].ctime.valueOf() + segmentmSec ) ) ) {
                                                                var newFilename = timeDateStr( fileArray[file].ctime ) + ".mp4"
                                                                var writeStream = fs.createWriteStream( vidRoot + "/" + fileSplit[0] + "/" + newFilename )
                                                                fs.createReadStream( fw.settings.cachepath + "/" + fileArray[file].file ).pipe( writeStream );
                                                                newFiles.push( newFilename )
                                                                copyingCnt = copyingCnt + 1
                                                                writeStream.on( 'finish', function () { copyingCnt = copyingCnt - 1 });
                                                                lastWrite = fileArray[file].ctime
                                                            }
                                                        }
                                                        break;
                                                    default:
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        if ( newFiles.length > 0 ) fw.toHost( cameras[mycam].name, "recfiles", JSON.stringify( newFiles ), false )          // send new recorded files to any active subscribers
                        for (var alarm in cameras[mycam].motionTimes) {                         // Remove all motions that are not within the mp4 segment being written
                            if (cameras[mycam].motionTimes[alarm].start < latestMP4 && cameras[mycam].motionTimes[alarm].stop < latestMP4) cameras[mycam].motionTimes.splice(alarm, 1)                // Remove all motions from the array that we have processed
                        }
                        removeOldFiles(fileArray, latestMP4)
                    }
                });
            })( i );
        }
    });
}

var loopCnt = 0;
//Remove the old files from the ramdrive after they have been copied to the archive
function removeOldFiles(files, beforeTime) {
    if (copyingCnt !== 0) {
        loopCnt = loopCnt + 1
        if (loopCnt > 50) {                                         // If the copy counter isn't decrementing properly, delete anyway
            fw.log("Exceeded wait for motion copy. Pending copy: " + copyingCnt)
        } else {
            setTimeout(removeOldFiles, 10, files, beforeTime)       // Still copying, wait a bit longer
            return;
        }
    }
    loopCnt = 0;
    for ( var i = 0; i < files.length; ++i ) {
        if ( files[i].ctime < beforeTime) fs.unlink( fw.settings.cachepath + "/" + files[i].file, function ( err ) { if (err) fw.log(err + " error deleting file")})     // delete old file so that create date changes
    }
}

function motionDetect( display, camNum ) {

    var frameRate = parseInt( fw.settings.subframerate );                      // framerate (fps). Keep below 10, to allow capture of larger changes, and reduce CPU
    var camURL = "rtsp://" + fw.channels[camNum].attribs[0].value + ":" + fw.settings.rtspport + "/" + fw.channels[camNum].attribs[1].value          // substream
    var blurSize = fw.settings.blursize;                           // Apply gaussian blur to remove noise, creates large pixels
    var blurSD = fw.settings.blursd;                               // smooth out the change between the large pixel
    var diffChange = fw.settings.diffchange;                       //amount of the change between frame pixels before registering as a change
    var triggerSensitivity = fw.settings.triggersensitivity;       // Total amount of pixels that are above the change threshold in the picture before triggering motion (normalised to screen size - range 0 to 1)
    var motionDurationToTrig = fw.settings.motiondurationtotrig;   // How long (seconds) do we have to see consequtive motion before triggering
    var releaseTrigTime = fw.settings.releasetrigtime;             // Once triggered, how long before another trigger can be generated (secs)
    var largeChangeThresh = fw.settings.largechangethresh          // reject interframe changes that are greater than this percentage

    try {
        var ramFiles = fs.readdirSync( fw.settings.cachepath )
        for ( var file in ramFiles ) fs.unlinkSync( fw.settings.cachepath + ramFiles[file] )     // delete old files in ramdrive
    } catch ( err ) { }

    //var opencv = child_process.spawn("opencvcpp", [display, diffChange, blurSize, blurSD, frameRate, triggerSensitivity, motionDurationToTrig, releaseTrigTime, largeChangeThresh, camURL, cameras[camNum].masks]);
    var opencv = child_process.spawn( "opencv/opencvcpp", [display, diffChange, blurSize, blurSD, frameRate, camURL, cameras[camNum].masks] );
    // #1 = display (1/0), #2 = diff Change, #3 = blursize, #4 = blurSD, #5 = frame rate, #6 = rtsp string, #7 = JSON mask array

    //TODO: Make this multi-camera 
    var retString, diff, retCamNum, commIndex;
    opencv.stdout.on( "data", function ( data ) {
        retString = data.toString()
        if ( retString.substring( 0, 5 ) === "Diff:" ) {
            commIndex = retString.indexOf( "," )
            retCamNum = parseInt( retString.substring( 5, commIndex ) )
            diff = parseInt( retString.substring( commIndex + 1 ) )
            if ( diff > cameras[retCamNum].normTrigger && diff < largeChangeThresh * cameras[retCamNum].maxChange ) {           // don't react to changes too small or too big
                fw.log( "Cam: " + retCamNum + " Primed: " + diff )
                cameras[retCamNum].alarmTriggeredTimer = 0;                                                    // wait until motion stopped before letting timer count for another trigger
                if ( cameras[retCamNum].primed === false ) {
                    cameras[retCamNum].primed = true;
                    saveSnapShot( retCamNum );
                    cameras[retCamNum].motionStart = new Date()                     // potential new trigger
                }
                cameras[retCamNum].primeTrigTimer = cameras[retCamNum].primeTrigTimer + 1                                         // add up number of consecutive changed frames
                if ( cameras[retCamNum].primeTrigTimer > frameRate * motionDurationToTrig ) {             // we have motion
                    if ( cameras[retCamNum].motion === false ) {
                        cameras[retCamNum].primeTrigTimer = 0;
                        cameras[retCamNum].motion = true;
                        motionAlarm.emit( "motion", retCamNum, diff );
                    }
                }
            } else {
                if ( cameras[retCamNum].primeTrigTimer > 0 ) {
                    fw.log( "Cam: " + retCamNum + " Primed reset: " + diff )
                } else {
                    if ( display && diff > 0 ) fw.log( "Cam: " + retCamNum + " Difference: " + diff )
                }
                cameras[retCamNum].primed = false;                  // no more motion, stop snapshots
                cameras[retCamNum].primeTrigTimer = 0;
            }
            if ( cameras[retCamNum].motion === true ) {
                cameras[retCamNum].alarmTriggeredTimer = cameras[retCamNum].alarmTriggeredTimer + 1;                              // wait until releaseTrigTime before resetting motion alarm
                if ( cameras[retCamNum].alarmTriggeredTimer > frameRate * releaseTrigTime ) {
                    cameras[retCamNum].motion = false;
                    cameras[camNum].motionTimes.push( { start: cameras[camNum].motionStart, stop: new Date() })                        // end of motion, register
                }
            }
        } else {
            if ( retString.substring( 0, 4 ) === "Max:" ) {                                      // Get maximum pixel count to use for calculating percentages for tuning parameters
                commIndex = retString.indexOf( "," )
                retCamNum = parseInt( retString.substring( 4, commIndex ) )
                cameras[retCamNum].maxChange = parseInt( retString.substring( commIndex + 1 ) )                        // Set maximum pixel count for camera based on mask size
                cameras[retCamNum].normTrigger = cameras[retCamNum].maxChange * triggerSensitivity                  // values above this figure will prime the alarm trigger
                if ( display ) fw.log( "Cam: " + retCamNum + " MaxChange: " + cameras[retCamNum].maxChange + ", TrigChange: " + cameras[retCamNum].normTrigger )
            }
        }
    });

    opencv.stderr.on( "data", function ( data ) {
        fw.log( 'MotionDetect Status: ' + data.toString() );
    });
    return true;
}

// Setup the motion detector mask
function setMask( camNum, myMask ) {
    cameras[camNum].masks = myMask
    var masks = JSON.parse( myMask )
    //TODO: Reset masks in the .exe (restart it)
}

function startCameras() {
    vidRoot = process.env[( process.platform == 'win32' ) ? 'USERPROFILE' : 'HOME'] + "/Videos/" + fw.settings.videopath
    segmentmSec = parseInt( fw.settings.recordingsegment ) * 1000                    // sync timer with segment duration
    fs.mkdir( vidRoot, function () { })                 // Create folder security videos (ignore errors if already created)

    if ( !fs.existsSync( fw.settings.cachepath ) ) {
        fw.log( "ERROR: No RAMDISK for camera capture. Exiting" );
        return;
    }

    for ( var cam in fw.channels ) {
        if ( fw.channels[cam].type.toLowerCase() === "video" ) {

            var mainStream = fw.channels[cam].attribs[0].type.toLowerCase() + fw.channels[cam].attribs[0].value + ":" + fw.settings.rtspport + "/" + fw.channels[cam].attribs[2].value
            var ffmpegptr = startFFMPEG( mainStream, fw.settings.recordingsegment, fw.channels[cam].name )

            fs.mkdir( vidRoot + "/" + fw.channels[cam].name, function () { })                  // create directory, ignore error if it already exists

            // regularly match the timestamp for motion with the relevant recording and save it with a timestamp name if there is a motion trigger

            //TODO: ffmpegPTR not needed?
            cameras.push( new camera( fw.channels[cam].name, fw.channels[cam].desc, mainStream, fw.channels[cam].attribs[4].type + fw.channels[cam].attribs[0].value + "/" + fw.channels[cam].attribs[4].value, fw.channels[cam].attribs[3].value, "active", ffmpegptr ) )
            //toHost(channels[cam].name, "camcfg", JSON.stringify({"name": channels[cam].name, "desc": channels[cam].desc, "rtsp": channels[cam].attribs[0].value, "masks": channels[cam].attribs[1].value}))                     // Send camera info to host statestore so that client can read configs
        }
    }

    return true;
}

function timeDateStr( alarmDate ) {
    var getMonth = ( parseInt( alarmDate.getMonth() ) + 1 ).toString()
    if ( getMonth.length === 1 ) getMonth = "0" + getMonth
    var getDay = alarmDate.getDate().toString()
	if ( getDay.length === 1 ) getDay = "0" + getDay
	var getHours = alarmDate.getHours().toString()
	if ( getHours.length === 1 ) getHours = "0" + getHours
	var getMins = alarmDate.getMinutes().toString()
	if ( getMins.length === 1 ) getMins = "0" + getMins
	var getSecs = alarmDate.getSeconds().toString()
	if ( getSecs.length === 1 ) getSecs = "0" + getSecs
	return alarmDate.getFullYear().toString() + getMonth + getDay + "_" + getHours + getMins + getSecs + "." + parseInt( alarmDate.getMilliseconds() / 100 )
}

// startup function
function startup() {

    motionAlarm.on( "motion", function ( camNum, val ) {
        fw.log( "=====> Motion detected from camera: " + camNum + " value: " + val )
        fw.toHost( cameras[camNum].name, "motion", new Date().toString() );
    });

    if ( startCameras() ) {
        //Live video Server
        liveServer = http.createServer( liveStream );
        var liveSvr = liveServer.listen(parseInt(fw.settings.liveport));
        fw.log("Live video server running at port " + fw.settings.liveport);
        liveSvr.on("error", function (err) {
            fw.log("Error with the Live server " + err);
        });
        liveSvr.on("close", function () {
            setTimeout(function () {
                fw.log("Live Server closed. Restarting...");
                liveServer.listen(parseInt(fw.settings.liveport));
            }, 1000);
        });

        // Recorded video Server
        recServer = http.createServer( recStream );
        var recSvr = recServer.listen(parseInt(fw.settings.recport));
        fw.log( "Recording video server running at port " + fw.settings.recport );
        recSvr.on("error", function (err) {
            fw.log("Error with the Rec server " + err);
        });
        recSvr.on("close", function () {
            setTimeout(function () {
                fw.log("Rec Server closed. Restarting...");
                recServer.listen(parseInt(fw.settings.recport));
            }, 1000);
        });

        // Motion detection
        if ( motionDetect( 1, 0 ) ) {
            fw.log( "Motion detection service started" );
        } else {
            fw.log( "Unable to start motion detection service" );
        }

        return "OK"                                 // Return 'OK' only if startup has been successful to ensure startup errors disable plugin
    } else return "Cameras did not start"

}

// Process host messages
function fromHost(channel, scope, data) {
    //debugger
    switch ( scope ) {
        case "mask":
            for ( var myCh in fw.channels ) if ( fw.channels[myCh].name === channel ) {                   // find the camera in the camera array
                global.writeIni( cat, name, "channel" + myCh, "attrib3", "Value", data )          // Save new mask to ini file
                setMask( myCh, data )                                                             // change the active mask
                return "OK";
            }
            return;
            break;
        case "recfiles":
            for ( var myCh in fw.channels ) if ( fw.channels[myCh].name === channel ) {                   // find the camera in the camera array
                var files = fs.readdirSync( vidRoot + "/" + channel )
                fw.toHost( channel, "recfiles", JSON.stringify( files ), false)
                return "OK";
            }
            return;
            break;
        default:
    }
    return "OK"
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
            fw.restart = function (code) { process.send({ func: "restart", data: code }); };
            fw.log = function (msg) { process.send({ func: "log", cat: fw.cat, name: fw.plugName, log: msg }); };
            fw.toHost = function (myChannel, myScope, myData, myLog) { process.send({ func: "tohost", cat: fw.cat, name: fw.plugName, channel: myChannel, scope: myScope, data: myData, log: myLog }); };
            fw.addChannel = function (name, desc, type, io, min, max, units, attribs, value, store) { process.send({ func: "addch", cat: fw.cat, name: fw.plugName, channel: name, scope: desc, data: { type: type, io: io, min: min, max: max, units: units, attribs: attribs, value: value, store: store } }); };
            fw.writeIni = function (section, subSection, key, value) { process.send({ func: "writeini", cat: fw.cat, name: fw.plugName, data: { section: section, subSection: subSection, key: key, value: value } }); };
            retval = startup();
            break;
        case "fromhost":
            retval = fromHost(msg.param0, msg.param1, msg.param2)
            break;
        case "shutdown":
            retval = shutPlugin(msg.param0);
            break;
    }
    process.send({ func: msg.func, cat: fw.cat, name: fw.plugName, data: retval });
});


//00 00 00 20 66 74 79 70 = 32 bytes for ftyp, and 24 bytes of payload
//69 73 6f 6d 00 00 02 00 69 73 6f 6d 69 73 6f 32 61 76 63 31 6d 70 34 31 = ftyp payload identifying MP4

//The ftyp atom is ALWAYS first, and has a certain type of format - it tells what type of file it is & the basic versioning of the atom structures
//* * * * 66 74 79 70 where the first 4 bytes is the length of the ftyp which includes the length & atom bytes
//00 00 00 08 = 8 bytes for next atom, atom name free (66 72 65 65)
//next atom is 0 length mdat 00 00 00 00 6d 64 61 74 where 
// http://atomicparsley.sourceforge.net/mpeg-4files.html
//MP4 header with empty moov
//0x00 0x00 0x00 0x20 0x66 0x74 0x79 0x70 0x69 0x73 0x6f 0x6d 0x00 0x00 0x02 0x00 0x69 0x73 0x6f 0x6d 0x69 0x73 0x6f 0x32 0x61 0x76 0x63 0x31 0x6d 0x70 0x34 0x31 0x00 0x00 0x00 0x08 0x66 0x72 0x65 0x65 0x00 0x00 0x00 0x00 0x6d 0x64 0x61 0x74  

//var mp4header = new Uint8Array(48);

//var mp4header = new Buffer([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, 0x69, 0x73, 0x6f, 
//    0x6d, 0x69, 0x73, 0x6f, 0x32, 0x61, 0x76, 0x63, 0x31, 0x6d, 0x70, 0x34, 0x31, 0x00, 0x00, 0x00, 0x08, 0x66, 0x72, 0x65, 0x65, 
//    0x00, 0x00, 0x00, 0x00, 0x6d, 0x64, 0x61, 0x74])

