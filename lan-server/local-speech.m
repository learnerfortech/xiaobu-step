// Local-only synthesis to WAV on stdout. No audio files and no network requests.
#import <Foundation/Foundation.h>
#import <AVFoundation/AVFoundation.h>
#import <math.h>
static void u16(NSMutableData *d,uint16_t n){uint16_t x=CFSwapInt16HostToLittle(n);[d appendBytes:&x length:2];}
static void u32(NSMutableData *d,uint32_t n){uint32_t x=CFSwapInt32HostToLittle(n);[d appendBytes:&x length:4];}
int main(){@autoreleasepool{
 NSData *input=[[NSFileHandle fileHandleWithStandardInput] readDataToEndOfFile];
 NSString *text=[[NSString alloc] initWithData:input encoding:NSUTF8StringEncoding];if(!text.length||text.length>5000)return 2;
 AVSpeechSynthesizer *s=[AVSpeechSynthesizer new];AVSpeechUtterance *u=[[AVSpeechUtterance alloc] initWithString:text];
 // Choose an installed local Mandarin voice; do not request any voice downloads.
 AVSpeechSynthesisVoice *voice=nil;
 for(AVSpeechSynthesisVoice *v in AVSpeechSynthesisVoice.speechVoices)if([v.language isEqualToString:@"zh-CN"]){voice=v;break;}
 if(!voice)return 3;u.voice=voice;u.rate=0.43;u.pitchMultiplier=1;u.volume=1;
 __block NSMutableData *pcm=[NSMutableData data];__block uint32_t rate=0;
 [s writeUtterance:u toBufferCallback:^(AVAudioBuffer *buffer){
  if(![buffer isKindOfClass:AVAudioPCMBuffer.class])exit(4);AVAudioPCMBuffer *b=(AVAudioPCMBuffer *)buffer;
  if(!b.frameLength){if(!pcm.length||!rate)exit(5);
   NSMutableData *wav=[NSMutableData data];[wav appendBytes:"RIFF" length:4];u32(wav,(uint32_t)pcm.length+36);[wav appendBytes:"WAVEfmt " length:8];u32(wav,16);u16(wav,1);u16(wav,1);u32(wav,rate);u32(wav,rate*2);u16(wav,2);u16(wav,16);[wav appendBytes:"data" length:4];u32(wav,(uint32_t)pcm.length);[wav appendData:pcm];
   fwrite(wav.bytes,1,wav.length,stdout);fflush(stdout);exit(0);
  }
  if(rate&&rate!=(uint32_t)b.format.sampleRate)exit(6);rate=(uint32_t)b.format.sampleRate;
  if(b.format.commonFormat==AVAudioPCMFormatFloat32){float *p=b.floatChannelData[0];for(AVAudioFrameCount i=0;i<b.frameLength;i++){float v=p[i*b.stride];int16_t sample=(int16_t)(fmaxf(-1,fminf(1,v))*32767);u16(pcm,(uint16_t)sample);}}
  else if(b.format.commonFormat==AVAudioPCMFormatInt16){int16_t *p=b.int16ChannelData[0];for(AVAudioFrameCount i=0;i<b.frameLength;i++)u16(pcm,(uint16_t)p[i*b.stride]);}
  else exit(7);
  if(pcm.length>32*1024*1024)exit(8);
 }];
 dispatch_after(dispatch_time(DISPATCH_TIME_NOW,30*NSEC_PER_SEC),dispatch_get_main_queue(),^{exit(9);});[[NSRunLoop mainRunLoop] run];
}return 0;}
