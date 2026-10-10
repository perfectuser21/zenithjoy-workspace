import Foundation
import Vision
import AppKit
let url=URL(fileURLWithPath:CommandLine.arguments[1])
let request=VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages=["zh-Hans","en-US"]
request.usesLanguageCorrection=false
try VNImageRequestHandler(url:url).perform([request])
let out=(request.results ?? []).compactMap { observation -> [String:Any]? in
 guard let item=observation.topCandidates(1).first else{return nil}
 let b=observation.boundingBox
 return ["text":item.string,"confidence":item.confidence,"box":[b.minX,1-b.maxY,b.width,b.height]]
}
let data=try JSONSerialization.data(withJSONObject:out)
FileHandle.standardOutput.write(data)
