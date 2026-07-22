<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
"# StepiAI-API" 

## API behavior notes

- [StepiAI chat behavior and frontend compatibility](docs/AI_CHAT_BEHAVIOR.md)

## OpenAI integration

#### taruh OPENAI_API_KEY di local env.
Contoh Implementasi:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { OpenAiService } from '../../openai/openai.service';

@Controller('assistant')
export class AssistantController {
  constructor(private readonly openAi: OpenAiService) {}

  @Post('reply')
  async reply(@Body('prompt') prompt: string) {
    return {
      text: await this.openAi.generateText(prompt, {
        instructions: 'Reply with concise, actionable guidance.',
      }),
    };
  }
}
```

`synthesizeSpeech()` return binary audio and its matching content type, ready to send from a controller:

```ts
const speech = await this.openAi.synthesizeSpeech(text, { voice: 'coral' });
response.setHeader('Content-Type', speech.contentType);
response.send(speech.audio);
```


### Streaming voice input

`POST /api/openai/realtime/session` nanti ini yang buat  a short-lived, authenticated ephemeral key untuk di client browser WebRTC session. 

Nanti browser kirim microphone stream langsung ke OpenAI, biar  `OPENAI_API_KEY` tetep private. Server voice activity nanti detect dan identifiy speech turns dari user ataupun agent sidenya and baru kirim balik response setelah brief pause. The Realtime data channel emits live di `conversation.item.input_audio_transcription.delta` 
events nya ketika user sedang ngomong.

> Note: Implementasi FE nya tolong cari tahu ya, ku gak ngeh soalnya apakah works or not

```ts
const tokenResponse = await fetch('/api/openai/realtime/session', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ language: 'en', voice: 'marin' }),
});

const { value: ephemeralKey } = await tokenResponse.json();

const peerConnection = new RTCPeerConnection();
const assistantAudio = new Audio();
assistantAudio.autoplay = true;
peerConnection.ontrack = ({ streams }) => {
  const [stream] = streams;
  if (stream) {
    assistantAudio.srcObject = stream;
  }
};

const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
microphone
  .getTracks()
  .forEach((track) => peerConnection.addTrack(track, microphone));

const events = peerConnection.createDataChannel('oai-events');
events.addEventListener('message', ({ data }) => {
  const event = JSON.parse(data);

  if (event.type === 'conversation.item.input_audio_transcription.delta') {
    renderTranscript(event.delta);
  }
});

const offer = await peerConnection.createOffer();
await peerConnection.setLocalDescription(offer);

const answerResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${ephemeralKey}`,
    'Content-Type': 'application/sdp',
  },
  body: offer.sdp,
});

await peerConnection.setRemoteDescription({
  type: 'answer',
  sdp: await answerResponse.text(),
});
```

> AI GENERATED: 
The endpoint requires the existing Supabase bearer token and hashes the user ID
into OpenAI's safety identifier. To create a feature-specific voice experience,
inject `OpenAiService` into that controller and call
`createRealtimeClientSecret({ instructions: '...' })`; do not send a permanent
OpenAI key to the browser. `getClient()` remains available for other OpenAI
endpoints.
