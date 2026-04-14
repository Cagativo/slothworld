import { ImageProvider } from './ImageProvider';
import { TaskContext } from '../../../core/types/TaskContext';
import { ImageResult } from '../../../core/types/ImageResult';

const DEFAULT_MODEL = 'stable-diffusion-1.5';

export class HuggingFaceImageProvider implements ImageProvider {
	private readonly model: string;

	constructor(model: string = DEFAULT_MODEL) {
		this.model = model;
	}

	async generate(prompt: string, _context: TaskContext): Promise<ImageResult> {
		const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
		if (!normalizedPrompt) {
			throw new Error('huggingface_prompt_missing');
		}

		const apiKey = process.env.HUGGINGFACE_API_KEY;
		if (!apiKey) {
			throw new Error('huggingface_api_key_missing');
		}

		console.log('[HUGGINGFACE_IMAGE_REQUEST]', {
			model: this.model,
			promptLength: normalizedPrompt.length
		});

		const response = await fetch(`https://api-inference.huggingface.co/models/${this.model}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ inputs: normalizedPrompt })
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`huggingface_request_failed_${response.status}: ${errorText}`);
		}

		const createdAt = Date.now();
		const imageBase64 = Buffer.from(await response.arrayBuffer()).toString('base64');
		console.log('[HUGGINGFACE_IMAGE_SUCCESS]', {
			model: this.model,
			imageBytesApprox: Math.floor((imageBase64.length * 3) / 4)
		});

		return {
			path: '',
			prompt: normalizedPrompt,
			provider: 'huggingface',
			createdAt,
			contentBase64: imageBase64,
			mimeType: 'image/png',
			metadata: {
				model: this.model
			}
		};
	}
}

