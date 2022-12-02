FROM node:latest

ADD . /srv/app
WORKDIR /srv/app

RUN mkdir /srv/app/dav
RUN npm install
VOLUME /srv/app/dav

CMD ["node","server.js","--path=dav/","--host=0.0.0.0","--headless"]
EXPOSE 7000
