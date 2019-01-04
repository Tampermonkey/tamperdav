FROM node:latest

ADD . /srv/app
WORKDIR /srv/app

RUN mkdir /srv/app/dav
RUN npm install
VOLUME /srv/app/dav

CMD ["node","server.js","--path=dav/","--editor=false","--host=0.0.0.0"]
EXPOSE 7000
