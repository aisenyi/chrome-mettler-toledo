/**
* @author Davide Malvezzi
* @version 0.1.0
* The Serial Port Interface is a Google Chrome browser app to allow the use of serial ports comunication inside a web page.
*	The app acts as an wrapper between the web pages and the serial ports.
* The app use the chrome.serial API to interact with the serial ports and
* the chrome.runtime messaging API to exchange information with the web page.
* It is also provided a simple JavaScript library to use inside the web pages to access the services offered by the app.
*/

/**
* When a ::SerialPort instance is created a chrome.runtime.Port object is created too and it tries to connect to this app.
* If the connection is successfull the port will be saved inside the ::serialPort array with a unique GUID.
* The GUID will be used to identify which ::SerialPort is connnected to which page.
*/
var serialPort = [];

/**
* When a new serial connection is established the page GUID will be saved inside to this array.
* Each GUID index is the unique connectionId providev by the chrome.serial API.
*/
var serialConnections = [];

var weightLoop;

var isWeightLoop = false;

var oldWeight = 0;

/**
* Listener called when a new ::SerialPort instance is created.
* A GUID is generated and sent back to the web page and the comunication port is saved inside ::serialPort with the GUID as index.
*/
chrome.runtime.onConnectExternal.addListener(
	function(port) {
		var portIndex =  getGUID();
		serialPort[portIndex] = port;
		port.postMessage({header: "guid", guid: portIndex});
		port.onDisconnect.addListener(
			function(){
				serialPort.splice(portIndex, 1);
				console.log("Web page closed guid " + portIndex);
			}
		);

		console.log("New web page with guid " + portIndex);
	}
);

/**
* Listener to handle all the web pages requests.
* Commands:
*	- open -> ask to try to open a port
* - close -> ask to try to close a port
* - list -> ask to list all the connected serial devices
* - write -> ask to write some data on a port
* - installed -> check if this app is installed in the browser
*/
chrome.runtime.onMessageExternal.addListener(
	function(request, sender, sendResponse) {

		if(request.cmd === "open"){
			openPort(request, sender, sendResponse);
		}
		else if(request.cmd === "close"){
			closePort(request, sender, sendResponse);
		}
		else if(request.cmd === "list"){
			getPortList(request, sender, sendResponse);
		}
		else if(request.cmd === "write"){
			writeOnPort(request, sender, sendResponse);
		}
		else if(request.cmd === "installed"){
			checkInstalled(request, sender, sendResponse);
		}
		else if(request.cmd == "getweight"){
			isWeightLoop = true;
			//getWeight(request.connectionId);
			getWeight(request, sender, sendResponse);
		}
		else if(request.cmd == "stopweight"){
			isWeightLoop = false;
			clearInterval(weightLoop);
		}

		return true;
});

/**
*	Listener to handle the serial ports incoming data
* With the connectionId it retrieves the page GUID and then the port to send the data
* directly to the web page associated to the serial connection.
*/
chrome.serial.onReceive.addListener(
	function(info){
		var str = "";
		var dv = new DataView(info.data);
		for(var i = 0; i < dv.byteLength; i++){
			str = str.concat(String.fromCharCode(dv.getUint8(i, true)));
		}
		console.log({"str": str});
		if(isWeightLoop){
			var weight = parseFloat(str);
			if(isNaN(weight)){
				/*weightLoop = setTimeout(function(){
					getWeight(info.connectionId)
				}, 10000);*/
			}
			else{
				if(weight != oldWeight && weight > 0){
					var portGUID = serialConnections[info.connectionId];
					serialPort[portGUID].postMessage({header: "serialdata", data: Array.prototype.slice.call(new Uint8Array(info.data))});
					oldWeight = weight;
				}
				/*clearTimeout(weightLoop);
				setTimeout(function(){
					getWeight(info.connectionId)
				}, 10000);*/
			}
		}
		else{
			var portGUID = serialConnections[info.connectionId];
			serialPort[portGUID].postMessage({header: "serialdata", data: Array.prototype.slice.call(new Uint8Array(info.data))});
			console.log('Not in weighloop');
		}
	}
);

/**
*	Listener to handle the serial ports errors
* With the connectionId it retrieves the page GUID and then the port to send the error
* directly to the web page associated to the serial connection.
*/
chrome.serial.onReceiveError.addListener(
	function(errorInfo){
		console.error("Connection " + errorInfo.connectionId + " has error " + errorInfo.error);
		var portGUID = serialConnections[errorInfo.connectionId];
		serialPort[portGUID].postMessage({header: "serialerror", error: errorInfo.error});
	}
);

/**
*	Try to open a serial port.
* The request MUST contain:
* info.portName -> path to the port to open
* info.bitrate -> port bit rate as number
* info.dataBits -> data bit ("eight" or "seven")
* info.parityBit -> parity bit ("no", "odd" or "even")
* info.stopBits -> stop bit ("one" or "two")
*
* If the connection is established it will send to the web page result: "ok" and the connection info, otherwise
* it will send result: "error" and error: containing the error message.
*/
function openPort(request, sender, sendResponse){
	chrome.serial.connect(request.info.portName,
		{
		bitrate: request.info.bitrate,
		dataBits: request.info.dataBits,
		parityBit: request.info.parityBit,
		stopBits: request.info.stopBits
		},
		function(connectionInfo){
			if (chrome.runtime.lastError) {
				sendResponse({result: "error", error: chrome.runtime.lastError.message});
			}
			else{
				serialConnections[connectionInfo.connectionId] = request.portGUID;
				sendResponse({result:"ok", connectionInfo: connectionInfo});
			}
		}
	);
}

/**
*	Try to close a serial port.
* The request MUST contain:
* connectionId -> connection unique id provided when the port is opened
*
* If the connection is closed it will send to the web page result: "ok" and the connection info, otherwise
* it will send result: "error" and error: containing the error message.
*/
function closePort(request, sender, sendResponse){
	chrome.serial.disconnect(request.connectionId,
		function(connectionInfo){
			if (chrome.runtime.lastError) {
				sendResponse({result: "error", error: chrome.runtime.lastError.message});
			}
			else{
				serialConnections.slice(connectionInfo.connectionId, 1);
				sendResponse({result:"ok", connectionInfo: connectionInfo});
			}
		}
	);
}

/**
*	Get the list of all serial devices connected to the pc.
* If there is no error it will return an array of object containing:
* - path
* - vendorId (optional)
* - productId (optional)
* - displayName (optional)
*/
function getPortList(request, sender, sendResponse){
	chrome.serial.getDevices(
		function(ports){
			if (chrome.runtime.lastError) {
				sendResponse({result: "error", error: chrome.runtime.lastError.message});
			}
			else{
				sendResponse({result:"ok", ports: ports});
			}
		}
	);
}

/**
*	Write data on the serial port.
* The request MUST contain:
* connectionId -> connection unique id provided when the port is opened
* data -> Array which contains the bytes to send
*/
function writeOnPort(request, sender, sendResponse){
	chrome.serial.send(request.connectionId, new Uint8Array(request.data).buffer,
		function(response){
			if (chrome.runtime.lastError) {
				sendResponse({result: "error", error: chrome.runtime.lastError.message});
			}
			else{
				sendResponse({result:"ok", sendInfo: response});
			}
		}
	);
}

function getWeight(request, sender, sendResponse){
	var data = stringToArrayBuffer('W');
	weightLoop = window.setInterval(function(){
		chrome.serial.send(request.connectionId, new Uint8Array(data).buffer,
			function(response){
			}
		);
	}, 500);
}

function stringToArrayBuffer(string){
	var buffer = new ArrayBuffer(string.length);
	var dv = new DataView(buffer);
	for(var i = 0; i < string.length; i++){
	  dv.setUint8(i, string.charCodeAt(i));
	}
	return dv.buffer;
}

/**
* Used to check if this app is installed on the browser.
* If it's installed return result: "ok" and the current version.
*/
function checkInstalled(request, sender, sendResponse){
	var manifest = chrome.runtime.getManifest();
	sendResponse({result: "ok", version: manifest.version});
}

/**
* Generate a random GUID to associate at each port.
*/
function getGUID() {
	function s4() {
  	return Math.floor((1 + Math.random()) * 0x10000)
      .toString(16)
      .substring(1);
  }
  return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
    s4() + '-' + s4() + s4() + s4();
}
