FROM node:18-bullseye-slim
WORKDIR /app

RUN apt-get update
RUN apt-get install -y git
RUN rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

RUN git clone -n https://github.com/lrmn7/donlod.git --depth 1 && mv donlod/.git ./ && rm -rf donlod

COPY . .
EXPOSE 9000
CMD [ "node", "src/donlod" ]
