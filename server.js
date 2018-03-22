/**
 ЗАДАЧА
 Написать HTTP-сервер для загрузки и получения файлов
 - Все файлы находятся в директории files
 - Структура файлов НЕ вложенная.

 - Виды запросов к серверу
 GET / - index.html

 GET /file.ext
 - выдаёт файл file.ext из директории files,

 POST /file.ext
 - пишет всё тело запроса в файл files/file.ext и выдаёт ОК
 - если файл уже есть, то выдаёт ошибку 409
 - при превышении файлом размера 1MB выдаёт ошибку 413

 DELETE /file.ext
 - удаляет файл
 - выводит 200 OK
 - если файла нет, то ошибка 404

 Вместо file может быть любое имя файла.
 Так как поддиректорий нет, то при наличии / или .. в пути сервер должен выдавать ошибку 400.

 - Сервер должен корректно обрабатывать ошибки "файл не найден" и другие (ошибка чтения файла)
 - index.html или curl для тестирования

 */

// mime <-> Content-Type

// Пример простого сервера в качестве основы

const http = require('http');
const url = require('url');
const path = require('path');
const config = require('config');
const fs = require('fs');
const mime = require('mime');

module.exports = http.createServer((req, res) => {
    let pathname = decodeURI(url.parse(req.url).pathname);
    let filename = pathname.slice(1); // /file.ext -> file.ext

    if (filename.includes('/') || filename.includes('..')) {
        res.statusCode = 400;
        res.end('Nested paths are not allowed');
        return;
    }

    if (req.method === 'GET') {
        if (pathname === '/') {
            sendFile(config.get('publicRoot') + '/index.html', res);
        } else {
            let filepath = path.join(config.get('filesRoot'), filename);
            sendFile(filepath, res);
        }
    }

    if (req.method === 'POST') {

        if (!filename) {
            res.statusCode = 404;
            res.end('File not found');
        }
        receiveFile(path.join(config.get('filesRoot'), filename), req, res);

    }

    if (req.method === 'DELETE') {

        if (!filename) {
            res.statusCode = 404;
            res.end('File not found');
        }

        fs.unlink(path.join(config.get('filesRoot'), filename), err => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.statusCode = 404;
                    res.end('Not found');
                } else {
                    console.error(err);
                    res.statusCode = 500;
                    res.end('Internal error');
                }
            } else {
                res.statusCode = 200;
                res.end('Ok');
            }
        });

    }
});

function receiveFile(filepath, req, res) {

    // non-streaming client sends this
    if (req.headers['content-length'] > config.get('limitFileSize')) {
        res.statusCode = 413;
        res.end('File is too big!');
        return;
    }

    let size = 0;

    let writeStream = new fs.WriteStream(filepath, {flags: 'wx'});

    req
        .on('data', chunk => {
            size += chunk.length;

            if (size > config.get('limitFileSize')) {
                // early connection close before recieving the full request

                res.statusCode = 413;

                // if we just res.end w/o connection close, browser may keep on sending the file
                // the connection will be kept alive, and the browser will hang (trying to send more data)
                // this header tells node to close the connection
                // also see http://stackoverflow.com/questions/18367824/how-to-cancel-http-upload-from-data-events/18370751#18370751
                res.setHeader('Connection', 'close');

                // Some browsers will handle this as 'CONNECTION RESET' error
                res.end('File is too big!');

                writeStream.destroy();
                fs.unlink(filepath, err => {
                    /* ignore error */
                });

            }
        })
        .on('close', () => {
            writeStream.destroy();
            fs.unlink(filepath, err => {
                /* ignore error */
            });
        })
        .pipe(writeStream);

    writeStream
        .on('error', err => {
            if (err.code === 'EEXIST') {
                res.statusCode = 409;
                res.end('File exists');
            } else {
                console.error(err);
                if (!res.headersSent) {
                    res.writeHead(500, {'Connection': 'close'});
                    res.write('Internal error');
                }
                fs.unlink(filepath, err => {
                    /* ignore error */

                });
                res.end();
            }

        })
        .on('close', () => {
            // Note: can't use on('finish')
            // finish = data flushed, for zero files happens immediately,
            // even before 'file exists' check

            // for zero files the event sequence may be:
            //   finish -> error

            // we must use 'close' event to track if the file has really been written down
            res.end('OK');

        });

}


function sendFile(filepath, res) {
    let fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);

    fileStream
        .on('error', err => {
            if (err.code === 'ENOENT') {
                res.statusCode = 404;
                res.end('Not found');
            } else {
                console.error(err);
                if (!res.headersSent) {
                    res.statusCode = 500;
                    res.end('Internal error');
                } else {
                    res.end();
                }

            }
        })
        .on('open', () => {
            res.setHeader('Content-Type', mime.getType(filepath));
        });

    res
        .on('close', () => {
            fileStream.destroy();
        });

}
