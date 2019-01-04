FROM node:alpine

ADD . /srv/app
WORKDIR /srv/app

RUN mkdir /srv/app/dav
RUN npm install
VOLUME /srv/app/dav

CMD ["node","server.js","--path=dav/"]
EXPOSE 7000
