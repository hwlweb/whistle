var PassThrough = require('stream').PassThrough;
var net = require('net');
var url = require('url');
var rules = require('../rules');
var util = require('../../util');
var CRLF = '\r\n';
var CRLF_BUF = new Buffer(CRLF);
var MAX_BYTES = 1024 * 256;

function parsePairs(pairs, buffer, start) {
	for (var i = start || 0, len = buffer.length; i < len; i++) {
		var pair = getPair(buffer[i]);
		if (pair) {
			var value = pairs[pair.key];
			if (value) {
				if (!Array.isArray(value)) {
					value = [value];
				}
				value.push(pair.value);
			}
			pairs[pair.key] = value || pair.value;
		}
	}
	
	return pairs;
}

function getPair(line) {
	if (!(line = line && line.trim())) {
		return;
	}
	
	var index = line.indexOf(':');
	return index != -1 ? {
		key: line.substring(0, index).trim().toLowerCase(),
		value: line.substring(index + 1).trim()
	} : null;
}

function endIndexOf(buffer, start, end) {
	start = start || 0;
	end = end || buffer.length;
	for (; start < end; start++) {
		if (buffer[start] == CRLF_BUF[0] && buffer[start + 1] == CRLF_BUF[1]
		&& buffer[start + 2] == CRLF_BUF[0] && buffer[start + 3] == CRLF_BUF[1]) {
			return start;
		}
	}
	
	return -1;
}

module.exports = function parseHeaders(socket, config, callback) {
	var proxySocket, buffer, timeoutId, req;
	
	socket.on('error', callback).on('data', parseData);
	
	function parseData(data) {
		clearTimeout(timeoutId);
		buffer = buffer ? Buffer.concat([buffer, data]) : data;
		var endIndex = endIndexOf(buffer);
		if (endIndex == -1) {
			if (buffer.length > MAX_BYTES) {
				emitError(new Error('parse error'));
			} else {
				timeoutId = setTimeout(emitError, config.timeout);
			}
			return;
		}
		
		socket.removeListener('data', parseData);
		var headers = {};
		parsePairs(headers,  buffer.slice(0, endIndex).toString().trim().split(/\r\n/g), 1);
		var options = headers[config.httpsProxyHost];
		options = options && url.parse('http://' + options);
		if (!options || !net.isIP(options.hostname)) {
			return emitError(new Error('unsupport the request'));
		}
		
		req = new PassThrough();
		req.headers = headers;
		req.write(buffer);
		socket.pipe(req);
		options.host = options.hostname;
		req.options = options;
		callback(null, req);
	}
	
	function emitError(err) {
		socket.destroy();
		err = err || new Error('timeout');
		util.emitError(req, err);
		callback(err);
	}
};