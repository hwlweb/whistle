var net = require('net');
var url = require('url');
var path = require('path');
var os = require('os');
var StringDecoder = require('string_decoder').StringDecoder;
var PassThrough = require('stream').PassThrough;
var iconv = require('iconv-lite');
var zlib = require('zlib');
var PipeStream = require('pipestream');
var config = require('../package.json');

exports.LOCAL_DATA_PATH = path.join(__dirname, '../../' + config.dataDirname);
exports.config = config;

function noop() {}

exports.noop = noop;

var REG_EXP_RE = /^\/(.+)\/(i)?$/

exports.isRegExp = function isRegExp(regExp) {
	return REG_EXP_RE.test(regExp);
};


exports.getHost = function parseHost(_url) {
	_url = url.parse(setProtocol(_url || '')).hostname;
	return _url && _url.toLowerCase();
};


exports.toRegExp = function toRegExp(regExp) {
	regExp = REG_EXP_RE.test(regExp);
	try {
		regExp = regExp && new RegExp(RegExp.$1, RegExp.$2);
	} catch(e) {
		regExp = null;
	}
	return regExp;
};

exports.getFullUrl = function getFullUrl(req) {
	if (hasProtocol(req.url)) {
		req.url = url.parse(req.url).path;
	}
	return _getProtocol(req.isHttps) + req.headers.host + req.url;
};

function setProtocol(url, isHttps) {
	return hasProtocol(url) ? url : _getProtocol(isHttps) + url;
}

function _getProtocol(isHttps) {
	return isHttps ? 'https://' : 'http://';
}

function hasProtocol(url) {
	return /^[a-z0-9.+-]+:\/\//i.test(url);
}

function getProtocol(url) {
	return hasProtocol(url) ? url.substring(0, url.indexOf('://') + 1) : null;
}

function removeProtocol(url) {
	return hasProtocol(url) ? url.substring(url.indexOf('://') + 3) : url;
}

exports.hasProtocol = hasProtocol;
exports.setProtocol = setProtocol;
exports.getProtocol = getProtocol;
exports.removeProtocol = removeProtocol;

function toWhistleSsl(req, _url) {
	if (!req.isHttps || !hasProtocol(_url)) {
		return _url;
	}
	var options = url.parse(_url);
	if (options.protocol = 'https:') {
		options.protocol = 'http:';
		addWhistleSsl(options, 'hostname');
		addWhistleSsl(options, 'host')
	}
	
	return url.format(options);
}

function addWhistleSsl(options, name) {
	if (options[name]) {
		options[name] = config.whistleSsl + '.' + options[name];
	}
}

exports.toWhistleSsl = toWhistleSsl;

exports.isLocalAddress = function(address) {
	if (!address) {
		return false;
	}
	
	if (address == '127.0.0.1' || address == '0:0:0:0:0:0:0:1') {
		return true;
	}
	
	address = address.toLowerCase();
	var interfaces = os.networkInterfaces();
	for (var i in interfaces) {
		var list = interfaces[i];
		if (Array.isArray(list)) {
			for (var j = 0, info; info = list[j]; j++) {
				if (info.address.toLowerCase() == address) {
					return true;
				}
			}
		}
	}
	
	return false;
};

exports.isWebProtocol = function isWebProtocol(protocol) {
	return protocol == 'http:' || protocol == 'https:';
};


exports.drain = function drain(stream, end) {
	if (end) {
		stream._readableState.endEmitted ? end.call(stream) : stream.on('end', end);
	}
	stream.on('data', noop);
};

exports.encodeNonAsciiChar = function encodeNonAsciiChar(str) {
	
	return  str ? str.replace(/[^\x00-\x7F]/g, encodeURIComponent) : str;
};

exports.getPath = function getPath(url) {
	url = url && url.replace(/\/?(?:\?|#).*$/, '') || '';
	var index = url.indexOf('://');
	return index > -1 ? url.substring(index + 3) : url;
};

exports.wrapResponse = function wrapResponse(res) {
	var passThrough = new PassThrough();
	passThrough.statusCode = res.statusCode;
	passThrough.headers = res.headers || {};
	passThrough.headers.Server = config.name;
	passThrough.push(res.body == null ? null : String(res.body));
	return passThrough;
};

exports.parseJSON = function parseJSON(data) {
	try {
		return JSON.parse(data);
	} catch(e) {}
	
	return null;
}

function getContentType(contentType) {
	if (contentType && typeof contentType != 'string') {
		contentType = contentType['content-type'] || contentType.contentType;
	}
	
	if (typeof contentType == 'string') {
		contentType = contentType.toLowerCase();
		if (contentType.indexOf('javascript') != -1) {
	        return 'JS';
	    }
		
		if (contentType.indexOf('css') != -1) {
	        return 'CSS';
	    }
		
		if (contentType.indexOf('html') != -1) {
	        return 'HTML';
	    }
		
		if (contentType.indexOf('json') != -1) {
	        return 'JSON';
	    }
		
		if (contentType.indexOf('image') != -1) {
	        return 'IMG';
	    } 
	}
	
	return null;
}

exports.getContentType = getContentType;

function supportHtmlTransform(headers) {
	if (getContentType(headers) != 'HTML') {
		return false;
	}
	
	var contentEncoding = toLowerCase(headers && headers['content-encoding']);
	//chrome新增了sdch压缩算法，对此类响应无法解码
	return !contentEncoding || contentEncoding == 'gzip' || contentEncoding == 'deflate';
}

exports.supportHtmlTransform = supportHtmlTransform;

function wrapHtmlTransform(headers, transform) {
	if (!supportHtmlTransform(headers)) {
		return false;
	}
	
	var headers = headers || {};
	var contentEncoding = toLowerCase(headers['content-encoding']);
	var pipeStream = new PipeStream();
	switch (contentEncoding) {
	    case 'gzip':
	    	pipeStream.addHead(zlib.createGunzip());
	    	pipeStream.addTail(zlib.createGzip());
	      break;
	    case 'deflate':
	    	pipeStream.addHead(zlib.createInflate());
	    	pipeStream.addTail(zlib.createDeflate());
	      break;
	}
	
	var charset = getCharset(headers['content-type']);
	delete headers['content-length'];
	
	function pipeTransform() {
		var stream = new PipeStream();
		stream.add(transform, {end: false});
		stream.addHead(iconv.decodeStream(charset));
		stream.addTail(iconv.encodeStream(charset));
    	return stream;
	}
	
	if (charset) {
		pipeStream.add(pipeTransform());
	} else {
		pipeStream.addHead(function(res, callback) {
			var passThrough = new PassThrough();
			var decoder = new StringDecoder();
			var content = '';
			
			res.on('data', function(chunk) {
				if (!charset) {//如果没charset
					content += decoder.write(chunk);
					charset = getMetaCharset(content);
					setTransform();
				}
				passThrough.write(chunk);
			});
			
			res.on('end', function() {
				if (!charset) {
					content += decoder.end();
					charset = content.indexOf('�') != -1 ? 'gbk' : 'utf8';
					setTransform();
				}
				passThrough.end();
			});
			
			function setTransform() {
				if (charset) {
					var stream = pipeTransform();
					passThrough.pipe(stream);
					callback(stream);
				}
			}
			
		});
	}
	
	return pipeStream;
}

exports.wrapHtmlTransform = wrapHtmlTransform;

function toLowerCase(str) {
	return str && str.trim().toLowerCase();
}

exports.toLowerCase = toLowerCase;

var CHARSET_RE = /charset=([\w-]+)/i;
var META_CHARSET_RE = /<meta\s[^>]*\bcharset=(?:'|")?([\w-]+)[^>]*>/i;

function getCharset(str, isMeta) {
	
	return _getCharset(str);
}

function getMetaCharset(str) {
	
	return _getCharset(str, true);
}

function _getCharset(str, isMeta) {
	var charset;
	if ((isMeta ? META_CHARSET_RE : CHARSET_RE).test(str)) {
		charset = RegExp.$1;
		if (!iconv.encodingExists(charset)) {
			charset = null;
		}
	}
	
	return charset;
}

exports.getCharset = getCharset;
exports.getMetaCharset = getMetaCharset;


