#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <ImageIO/ImageIO.h>
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSURL *url=[NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    CGImageSourceRef source=CGImageSourceCreateWithURL((__bridge CFURLRef)url,NULL);
    if(!source)return 3;
    CGImageRef image=CGImageSourceCreateImageAtIndex(source,0,NULL);
    NSDictionary *props=CFBridgingRelease(CGImageSourceCopyPropertiesAtIndex(source,0,NULL));
    CFRelease(source);
    if(!image)return 3;
    if(CGImageGetWidth(image)>12000||CGImageGetHeight(image)>12000){CGImageRelease(image);return 3;}
    CGImagePropertyOrientation orientation=(CGImagePropertyOrientation)([props[(NSString*)kCGImagePropertyOrientation] unsignedIntValue]?:1);
    VNRecognizeTextRequest *request=[VNRecognizeTextRequest new];
    request.recognitionLevel=VNRequestTextRecognitionLevelAccurate;
    request.recognitionLanguages=@[@"zh-Hans",@"en-US"];
    request.usesLanguageCorrection=YES;
    VNImageRequestHandler *handler=[[VNImageRequestHandler alloc] initWithCGImage:image orientation:orientation options:@{}];
    NSError *error=nil;BOOL ok=[handler performRequests:@[request] error:&error];CGImageRelease(image);
    if(!ok)return 4;
    NSMutableArray *lines=[NSMutableArray new];
    for(VNRecognizedTextObservation *ob in request.results){VNRecognizedText *text=[ob topCandidates:1].firstObject;if(text.string)[lines addObject:text.string];}
    NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"text":[lines componentsJoinedByString:@"\n"]} options:0 error:&error];
    if(!data)return 4;
    [[NSFileHandle fileHandleWithStandardOutput] writeData:data];
    return 0;
  }
}
