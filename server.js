var PORT = process.argv[2];
var SECRET_KEY = process.argv[3] || null;
var EXPIRY_ACCURACY = process.argv[4] || 1000;
var HOST = '127.0.0.1';

var initialized = {};

var domain = require('domain');
var com = require('ncom');
var ExpiryManager = require('expirymanager').ExpiryManager;
var FlexiMap = require('fleximap').FlexiMap;

var escapeStr = '\\u001b';
var escapeArr = escapeStr.split('');

var send = function (socket, object) {
	socket.write(object);
};

var dataMap = new FlexiMap();
var eventMap = new FlexiMap();

var dataExpirer = new ExpiryManager();

var addListener = function (socket, event) {
	eventMap.set(['sockets', socket.id].concat(event), socket);
};

var hasListener = function (socket, event) {
	return eventMap.hasKey(['sockets', socket.id].concat(event));
};

var anyHasListener = function (event) {
	var sockets = eventMap.get('sockets');
	var i;
	for (i in sockets) {
		if (eventMap.hasKey(['sockets', i].concat(event))) {
			return true;
		}
	}
	return false;
};

var removeListener = function (socket, event) {
	eventMap.remove(['sockets', socket.id].concat(event));
};

var removeAllListeners = function (socket) {
	eventMap.remove(['sockets', socket.id]);
};

var getListeners = function (socket) {
	return eventMap.get(['sockets', socket.id]);
};

var escapeBackslashes = function (str) {
	return str.replace(/([^\\])\\([^\\])/g, '$1\\\\$2');
};

var run = function (query, baseKey) {
	var rebasedDataMap;
	if (baseKey) {
		rebasedDataMap = dataMap.getRaw(baseKey);
	} else {
		rebasedDataMap = dataMap;
	}
	
	return Function('"use strict"; return (' + escapeBackslashes(query) + ')(arguments[0], arguments[1], arguments[2]);')(rebasedDataMap, dataExpirer, eventMap);
};

var actions = {
	init: function (command, socket) {	
		var result = {id: command.id, type: 'response', action: 'init'};
		
		if (command.secretKey == SECRET_KEY || !SECRET_KEY) {
			initialized[socket.id] = {};
		} else {
			result.error = 'nData Error - Invalid password was supplied to nData';
		}
		
		send(socket, result);
	},
	
	set: function (command, socket) {
		var result = dataMap.set(command.key, command.value);		
		var response = {id: command.id, type: 'response', action: 'set'};
		if (command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	expire: function (command, socket) {
		dataExpirer.expire(command.keys, command.value);
		var response = {id: command.id, type: 'response', action: 'expire'};
		send(socket, response);
	},
	
	unexpire: function (command, socket) {
		dataExpirer.unexpire(command.keys);
		var response = {id: command.id, type: 'response', action: 'unexpire'};
		send(socket, response);
	},
	
	getExpiry: function (command, socket) {
		var response = {id: command.id, type: 'response', action: 'getExpiry', value: dataExpirer.getExpiry(command.key)};
		send(socket, response);
	},
	
	get: function (command, socket) {
		var result = dataMap.get(command.key);
		send(socket, {id: command.id, type: 'response', action: 'get', value: result});
	},
	
	getRange: function (command, socket) {
		var result = dataMap.getRange(command.key, command.fromIndex, command.toIndex);
		send(socket, {id: command.id, type: 'response', action: 'getRange', value: result});
	},
	
	getAll: function (command, socket) {
		send(socket, {id: command.id, type: 'response', action: 'getAll', value: dataMap.getAll()});
	},
	
	count: function (command, socket) {
		var result = dataMap.count(command.key);
		send(socket, {id: command.id, type: 'response', action: 'count', value: result});
	},
	
	add: function (command, socket) {
		var result = dataMap.add(command.key, command.value);
		var response = {id: command.id, type: 'response', action: 'add'};
		if (command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	concat: function (command, socket) {
		var result = dataMap.concat(command.key, command.value);
		var response = {id: command.id, type: 'response', action: 'concat'};
		if (command.getValue) {
			response.value = result;
		}
		send(socket, response);
	},
	
	registerDeathQuery: function (command, socket) {
		var response = {id: command.id, type: 'response', action: 'registerDeathQuery'};
		
		if (initialized[socket.id]) {
			initialized[socket.id].deathQuery = command.value;
		}
		
		send(socket, response);
	},
	
	run: function (command, socket) {
		var ret = {id: command.id, type: 'response', action: 'run'};
		try {
			var result = run(command.value, command.baseKey);
			if (result !== undefined) {
				ret.value = result;
			}
		} catch(e) {
			if (e.stack) {
				e = e.stack;
			}
			ret.error = 'nData Error - Exception at run(): ' + e;
		}
		if (!command.noAck) {
			send(socket, ret);
		}
	},
	
	remove: function (command, socket) {
		var result = dataMap.remove(command.key);
		if (!command.noAck) {
			var response = {id: command.id, type: 'response', action: 'remove'};
			if (command.getValue) {
				response.value = result;
			}
			send(socket, response);
		}
	},
	
	removeRange: function (command, socket) {
		var result = dataMap.removeRange(command.key, command.fromIndex, command.toIndex);
		if (!command.noAck) {
			var response = {id: command.id, type: 'response', action: 'removeRange'};
			if (command.getValue) {
				response.value = result;
			}
			send(socket, response);
		}
	},
	
	removeAll: function (command, socket) {
		dataMap.removeAll();
		if (!command.noAck) {
			send(socket, {id: command.id, type: 'response', action: 'removeAll'});
		}
	},
	
	pop: function (command, socket) {
		var result = dataMap.pop(command.key);
		if (!command.noAck) {
			var response = {id: command.id, type: 'response', action: 'pop'};
			if (command.getValue) {
				response.value = result;
			}
			send(socket, response);
		}
	},
	
	hasKey: function (command, socket) {
		send(socket, {id: command.id, type: 'response', action: 'hasKey', value: dataMap.hasKey(command.key)});
	},
	
	watch: function (command, socket) {
		addListener(socket, command.event);
		send(socket, {id: command.id, type: 'response', action: 'watch', event: command.event});
	},
	
	watchExclusive: function (command, socket) {
		var listening = anyHasListener(command.event);
		if (!listening) {
			addListener(socket, command.event);
		}
		send(socket, {id: command.id, type: 'response', action: 'watchExclusive', event: command.event, value: listening});
	},
	
	unwatch: function (command, socket) {
		if (command.event) {
			removeListener(socket, command.event);
		} else {
			removeAllListeners(socket);
		}
		
		send(socket, {id: command.id, type: 'response', action: 'unwatch', event: command.event});
	},
	
	isWatching: function (command, socket) {
		var result = eventMap.hasKey('sockets.' + socket.id + '.' + command.event);
		send(socket, {id: command.id, type: 'response', action: 'isWatching', event: command.event});
	},
	
	broadcast: function (command, socket) {
		var sockets = eventMap.get('sockets');
		var i, sock, eventKey;
		for (i in sockets) {
			eventKey = ['sockets', i].concat(command.event);
			if (eventMap.hasKey(eventKey)) {
				sock = eventMap.get(eventKey);
				if (sock instanceof com.ComSocket) {
					send(sock, {type: 'event', event: command.event, value: command.value});
				}
			}
		}
		send(socket, {id: command.id, type: 'response', action: 'broadcast', value: command.value, event: command.event});
	}
};

var MAX_ID = Math.pow(2, 53) - 2;
var curID = 1;

var genID = function () {
	curID++;
	curID = curID % MAX_ID;
	return curID;
};

var server = com.createServer();

var errorHandler = function (err) {
	var error;
	
	if (err.stack) {
		error = {
			message: err.message,
			stack: err.stack
		};
	} else {
		error = err;
	}
	
	process.send({event: 'error', data: error});
};

var evaluate = function (str) {
	return Function('"use strict"; return ' + dataMap.escapeBackslashes(str) + ' || null;')();
};

var substitute = function (str) {
	return dataMap.get(str);
};

var convertToString = function (object) {
	var str;
	if (typeof object == 'string') {
		str = object;
	} else if (typeof object == 'number') {
		str = object;
	} else if (object == null) {
		str = null;
	} else if (object == undefined) {
		str = object;
	} else {
		str = object.toString();
	}
	return str;
};

var errorDomain = domain.create();
errorDomain.on('error', errorHandler);

var handleConnection = errorDomain.bind(function (sock) {
	errorDomain.add(sock);
	sock.id = genID();
	sock.on('message', function (command) {
		if (!SECRET_KEY || initialized.hasOwnProperty(sock.id) || command.action == 'init') {
			try {
				if (actions[command.action]) {
					actions[command.action](command, sock);
				}
			} catch(e) {
				if (e.stack) {
					console.log(e.stack);
				} else {
					console.log(e);
				}
				if (e instanceof Error) {
					e = e.toString();
				}
				send(sock, {id: command.id, type: 'response', action:  command.action, error: 'nData Error - Failed to process command due to the following error: ' + e});
			}
		} else {
			var e = 'nData Error - Cannot process command before init handshake';
			console.log(e);
			send(sock, {id: command.id, type: 'response', action: command.action, error: e});
		}
	});
	
	sock.on('close', function () {
		if (initialized[sock.id]) {
			if (initialized[sock.id].deathQuery) {
				run(initialized[sock.id].deathQuery);
			}
			delete initialized[sock.id];
		}
		removeAllListeners(sock);
		errorDomain.remove(sock);
	});
});

errorDomain.add(server);
server.on('connection', handleConnection);

server.on('listening', function () {
	process.send({event: 'listening'});
});

server.listen(PORT, HOST);

setInterval(function () {
	var keys = dataExpirer.extractExpiredKeys();
	for (var i in keys) {
		dataMap.remove(keys[i]);
	}
}, EXPIRY_ACCURACY);